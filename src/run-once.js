#!/usr/bin/env node
import path from 'node:path';
import { envConfig, loadImageConfig, timestampSlug } from './config.js';
import { fetchHeadlines } from './news.js';
import { extractKeywordsFromHeadlines } from './keywords.js';
import { buildPrompt } from './prompt.js';
import { fallbackRandomImage, pickRandomImageFromDir, saveImage } from './image.js';
import { generateOpenAIImageWithQa } from './imageWorkflow.js';
import { refinePromptWithOpenAI } from './refinePrompt.openai.js';
import { setWallpaper } from './wallpaper.js';
import { ensureDir, log, nowLocal, joinUniqueWords } from './util.js';

function isQuotaError(err) {
  const msg = (err?.message || String(err || '')).toLowerCase();
  return err?.status === 429 ||
    msg.includes('insufficient tokens') ||
    msg.includes('quota') ||
    msg.includes('billing');
}

function isTruthyEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function printContributingHeadlines(headlines, { limit } = {}) {
  const selected = Array.isArray(headlines) ? headlines.slice(0, limit || headlines.length) : [];
  if (!selected.length) {
    console.log('Contributing headlines: none');
    return;
  }

  console.log(`Contributing headlines (${selected.length}):`);
  selected.forEach((headline, index) => {
    console.log(`${String(index + 1).padStart(2, ' ')}. ${headline}`);
  });
}

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
  const RUN_VERBOSE = args.includes('run-verbose') ||
    args.includes('--run-verbose') ||
    args.includes('--verbose') ||
    args.includes('-v') ||
    isTruthyEnv(process.env.RUN_VERBOSE);
  const FOCUS = (focusArg || process.env.FOCUS || '').trim();
  if (FOCUS) log('Focus:', FOCUS);
  const PROMPT_OVERRIDE = (promptArg || process.env.CUSTOM_PROMPT || '').trim();
  if (PROMPT_OVERRIDE) log('Prompt override detected');
  const rawProvider = (providerArg || process.env.IMAGE_PROVIDER || 'openai').trim().toLowerCase();
  const PROVIDER = rawProvider === 'gemini' ? 'openai' : rawProvider;
  if (rawProvider === 'gemini') {
    console.warn('IMAGE_PROVIDER=gemini is no longer used; using OpenAI instead.');
  }
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
  let selectedStyle = '';
  let promptHeadlines = headlines;
  let embeddedHeadlineText = null;
  let effectiveNegativePrompt = cfg.negative || '';
  if (env.OPENAI_API_KEY && !PROMPT_OVERRIDE) {
    try {
      const {
        prompt: p,
        selectedStyle: style,
        selectedHeadlines,
        embeddedHeadlineText: embedded,
        effectiveNegativePrompt: negativePrompt
      } = await refinePromptWithOpenAI({
        headlines,
        keywords,
        basePrompt,
        cfg,
        apiKey: env.OPENAI_API_KEY,
        model: process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_MODEL || cfg.openaiTextModel || 'gpt-5.4-mini',
        date
      });
      refinedPrompt = p;
      selectedStyle = style || '';
      promptHeadlines = selectedHeadlines || headlines;
      embeddedHeadlineText = embedded || null;
      effectiveNegativePrompt = negativePrompt || effectiveNegativePrompt;
    } catch (e) {
      console.error('OpenAI prompt refinement failed:', e.message);
    }
  }
  log('RefinedPrompt:', refinedPrompt);

  if (RUN_VERBOSE) {
    const limit = Number.isInteger(cfg?.headlinePromptLimit) ? cfg.headlinePromptLimit : 12;
    printContributingHeadlines(promptHeadlines, { limit });
  }

  // 4) Generate image
  const ts = timestampSlug(date);
  const outDir = path.resolve(process.cwd(), env.OUTPUT_DIR);
  await ensureDir(outDir);

  const baseName = `background-${ts}`;
  let imgPath = '';
  let buffer;
  const { width = 2560, height = 1440 } = cfg.resolution || {};
  try {
    if ((PROVIDER === 'openai' || !PROVIDER) && env.OPENAI_API_KEY) {
      const generation = await generateOpenAIImageWithQa({
        prompt: refinedPrompt,
        apiKey: env.OPENAI_API_KEY,
        imageModel: process.env.OPENAI_IMAGE_MODEL || cfg.openaiImageModel || 'gpt-image-1',
        qaModel: process.env.OPENAI_QA_MODEL || process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_MODEL || cfg.openaiTextModel || 'gpt-5.4-mini',
        width,
        height,
        cfg,
        source: 'auto',
        metadata: {
          headlines: promptHeadlines.slice(0, Number.isInteger(cfg?.headlinePromptLimit) ? cfg.headlinePromptLimit : 12),
          keywords,
          selectedStyle,
          basePrompt,
          embeddedHeadlineText,
          effectiveNegativePrompt
        }
      });
      buffer = generation.buffer;
      refinedPrompt = generation.prompt;
    } else if (PROVIDER === 'fallback') {
      buffer = await fallbackRandomImage(keywords, { width, height });
    } else if (PROVIDER === 'openai') {
      console.warn('OPENAI_API_KEY absent; using fallback image source');
    } else {
      console.warn(`Unknown IMAGE_PROVIDER "${PROVIDER}"; using fallback image source`);
    }
  } catch (e) {
    console.error('Image generation failed with provider', PROVIDER || 'default', '-', e.message);
    if (isQuotaError(e)) {
      imgPath = await pickRandomImageFromDir(outDir);
      if (imgPath) {
        console.log('Using existing image due to generation quota/billing error:', imgPath);
      } else {
        console.warn('No images found in output folder for quota/billing fallback.');
      }
    }
  }
  if (!buffer && !imgPath) {
    buffer = await fallbackRandomImage(keywords, { width, height });
  }

  if (!imgPath) {
    imgPath = await saveImage(buffer, outDir, baseName, 'png');
    console.log('Saved wallpaper:', imgPath);
  }

  // 5) Set wallpaper
  await setWallpaper(imgPath, env.DESKTOP_ENV);
  console.log('Wallpaper applied.');
}

main().catch((err) => {
  console.error('Error:', err?.message || err);
  process.exitCode = 1;
});
