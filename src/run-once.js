#!/usr/bin/env node
import path from 'node:path';
import { envConfig, loadImageConfig, resolveOutputPath, timestampSlug } from './config.js';
import { fetchHeadlines } from './news.js';
import { extractKeywordsFromHeadlines } from './keywords.js';
import { buildPrompt } from './prompt.js';
import { fallbackRandomImage, saveImage } from './image.js';
import { refinePromptWithOpenAI } from './refinePrompt.openai.js';
import { generateWithGemini } from './image-gemini.js';
import { setWallpaper } from './wallpaper.js';
import { ensureDir, log, nowLocal } from './util.js';

async function main() {
  const env = envConfig();
  const cfg = await loadImageConfig();
  const date = nowLocal();

  // 1) Fetch headlines
  const headlines = await fetchHeadlines(cfg.feeds || []);
  if (!headlines.length) throw new Error('No headlines fetched');

  // 2) Extract keywords
  const keywords = extractKeywordsFromHeadlines(headlines, cfg.keywords || {});
  if (!keywords.length) throw new Error('No keywords extracted');

  // 3) Build a base prompt (context) and refine via OpenAI for best quality
  const basePrompt = buildPrompt({ keywords, cfg, date });
  log('BasePrompt:', basePrompt);

  let refinedPrompt = basePrompt;
  if (env.OPENAI_API_KEY) {
    try {
      const { prompt: p } = await refinePromptWithOpenAI({
        headlines,
        keywords,
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
  if (process.env.GEMINI_API_KEY) {
    try {
      const modelToUse = process.env.GEMINI_MODEL || cfg.geminiModel;
      buffer = await generateWithGemini({
        prompt: refinedPrompt,
        apiKey: process.env.GEMINI_API_KEY,
        model: modelToUse,
        width,
        height,
        logSource: 'auto'
      });
    } catch (e) {
      console.error('Gemini generation failed:', e.message);
    }
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
