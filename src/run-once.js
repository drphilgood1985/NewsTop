#!/usr/bin/env node
import path from 'node:path';
import { envConfig, loadImageConfig, resolveOutputPath, timestampSlug } from './config.js';
import { fetchHeadlines } from './news.js';
import { extractKeywordsFromHeadlines } from './keywords.js';
import { buildPrompt } from './prompt.js';
import { generateWithOpenAI, fallbackRandomImage, saveImage } from './image.js';
import { refinePromptWithOpenAI } from './refinePrompt.openai.js';
import { setWallpaper } from './wallpaper.js';
import { ensureDir, log, nowLocal, joinUniqueWords } from './util.js';

async function main() {
  // Parse CLI args/environment for focus/prompt overrides
  const args = process.argv.slice(2);
  let focusArg = null;
  let promptArg = null;
   let providerArg = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-focus' || a === '--focus' || a === '-f') {
      focusArg = args[i + 1] || '';
      break;
    }
    const m = a.match(/^--?focus=(.*)$/);
    if (m) { focusArg = m[1]; break; }
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-prompt' || a === '--prompt' || a === '-p') {
      promptArg = args[i + 1] || '';
      break;
    }
    const m = a.match(/^--?prompt=(.*)$/);
    if (m) { promptArg = m[1]; break; }
    if (a.startsWith('-p=')) {
      promptArg = a.slice(3);
      break;
    }
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--provider') {
      providerArg = args[i + 1] || '';
      break;
    }
    const m = a.match(/^--provider=(.*)$/);
    if (m) { providerArg = m[1]; break; }
  }
  const FOCUS = (focusArg || process.env.FOCUS || '').trim();
  if (FOCUS) log('Focus:', FOCUS);
  const PROMPT_OVERRIDE = (promptArg || process.env.CUSTOM_PROMPT || '').trim();
  if (PROMPT_OVERRIDE) log('Prompt override detected');
  const PROVIDER = (providerArg || process.env.IMAGE_PROVIDER || 'openai').trim().toLowerCase();
  log('Image provider:', PROVIDER || 'default');

  const env = envConfig();
  const cfg = await loadImageConfig();
  const date = nowLocal();

  let headlines = [];
  let keywords = [];
  let basePrompt = PROMPT_OVERRIDE;

  if (PROMPT_OVERRIDE) {
    log('Using provided prompt override; skipping news aggregation');
    const tokens = PROMPT_OVERRIDE
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(w => w.length >= 3);
    if (tokens.length) {
      const max = (cfg.keywords && cfg.keywords.max) || 10;
      const merged = joinUniqueWords(tokens, max);
      keywords = merged.split(/\s*,\s*/).filter(Boolean);
    }
  } else {
    // 1) Fetch headlines
    headlines = await fetchHeadlines(cfg.feeds || []);
    if (FOCUS) {
      const q = FOCUS.toLowerCase();
      const words = Array.from(new Set(q.split(/[^\p{L}\p{N}]+/u).filter(Boolean)));
      const hasWord = (s) => {
        const low = (s || '').toLowerCase();
        if (q && low.includes(q)) return true; // phrase match
        // word match
        return words.some(w => w.length >= 3 && low.includes(w));
      };
      const filtered = headlines.filter(h => hasWord(h));
      if (filtered.length) {
        log('Headlines filtered by focus:', filtered.length, 'of', headlines.length);
        headlines = filtered;
      } else {
        log('No headlines matched focus; proceeding without headline filter');
      }
    }
    if (!headlines.length) throw new Error('No headlines fetched');

    // 2) Extract keywords
    keywords = extractKeywordsFromHeadlines(headlines, cfg.keywords || {});
    if (FOCUS) {
      const focusWords = Array.from(new Set(FOCUS.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)));
      // Prepend focus words and trim to max unique items
      const max = (cfg.keywords && cfg.keywords.max) || 10;
      const merged = joinUniqueWords([...focusWords, ...keywords], max);
      keywords = merged.split(/\s*,\s*/).filter(Boolean);
    }
    if (!keywords.length) throw new Error('No keywords extracted');

    // 3) Build a base prompt (context) and refine via OpenAI for best quality
    basePrompt = buildPrompt({ keywords, cfg, date });
  }

  log('BasePrompt:', basePrompt);

  let refinedPrompt = basePrompt;
  if (env.OPENAI_API_KEY && !PROMPT_OVERRIDE) {
    try {
      const { prompt: p } = await refinePromptWithOpenAI({
        headlines,
        cfg,
        apiKey: env.OPENAI_API_KEY,
        model: cfg.openaiTextModel || process.env.OPENAI_MODEL || 'gpt-4.1',
        date
      });
      refinedPrompt = p;
    } catch (e) {
      console.error('OpenAI prompt refinement failed:', e.message);
    }
  }
  log('RefinedPrompt:', refinedPrompt);

  // 4) Generate image
  const ts = timestampSlug(date);
  const outDir = path.resolve(process.cwd(), env.OUTPUT_DIR);
  await ensureDir(outDir);

  const baseName = `background-${ts}`;
  let buffer;
  const { width = 2560, height = 1440 } = cfg.resolution || {};
  try {
    if ((PROVIDER === 'openai' || !PROVIDER) && env.OPENAI_API_KEY) {
      buffer = await generateWithOpenAI({
        prompt: refinedPrompt,
        apiKey: env.OPENAI_API_KEY,
        width,
        height
      });
    } else if (PROVIDER === 'fallback') {
      buffer = await fallbackRandomImage(keywords, { width, height });
    } else if (env.OPENAI_API_KEY) {
      buffer = await generateWithOpenAI({
        prompt: refinedPrompt,
        apiKey: env.OPENAI_API_KEY,
        width,
        height
      });
    }
  } catch (e) {
    console.error('Image generation failed with provider', PROVIDER || 'default', '-', e.message);
  }
  if (!buffer) {
    buffer = await fallbackRandomImage(keywords, { width, height });
  }

  const imgPath = await saveImage(buffer, outDir, baseName, 'png');
  console.log('Saved wallpaper:', imgPath);

  // 5) Set wallpaper
  await setWallpaper(imgPath, env.DESKTOP_ENV);
  console.log('Wallpaper applied.');
}

main().catch((err) => {
  console.error('Error:', err?.message || err);
  process.exitCode = 1;
});
