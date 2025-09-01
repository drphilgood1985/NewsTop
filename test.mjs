#!/usr/bin/env node
// Test runner that exercises the full pipeline with detailed logging
// - Console logs with timestamps and levels
// - File logs to logs/test-run-<timestamp>.log
// - JSON summary to logs/test-run-<timestamp>.summary.log

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';

import { envConfig, loadImageConfig } from './src/config.js';
import { fetchHeadlines } from './src/news.js';
import { extractKeywordsFromHeadlines } from './src/keywords.js';
import { buildPrompt } from './src/prompt.js';
import { fallbackRandomImage } from './src/image.js';
import { refinePromptWithOpenAI } from './src/refinePrompt.openai.js';
import { generateWithGemini } from './src/image-gemini.js';
import { setWallpaper } from './src/wallpaper.js';

function tsForFile(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    '-',
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds())
  ].join('');
}

async function main() {
  const started = new Date();
  const ts = tsForFile(started);

  const logsDir = path.resolve(process.cwd(), 'logs');
  await fsp.mkdir(logsDir, { recursive: true });
  const logFile = path.join(logsDir, `test-run-${ts}.log`);
  const summaryFile = path.join(logsDir, `test-run-${ts}.summary.log`);
  const out = fs.createWriteStream(logFile, { flags: 'a' });

  const stamp = () => new Date().toISOString();
  const writeLine = (s) => { process.stdout.write(s + os.EOL); out.write(s + os.EOL); };
  const clog = (level, ...parts) => writeLine(`[${stamp()}] [${level}] ${parts.join(' ')}`);
  const jlog = (level, obj) => writeLine(`[${stamp()}] [${level}] ${JSON.stringify(obj)}`);

  clog('INFO', 'Test run started', `cwd=${process.cwd()}`, `node=${process.version}`);

  // Load env + image config
  const env = envConfig();
  jlog('INFO', { env: { DESKTOP_ENV: env.DESKTOP_ENV, OUTPUT_DIR: env.OUTPUT_DIR, OPENAI: env.OPENAI_API_KEY ? 'present' : 'absent' } });

  let cfg;
  try {
    cfg = await loadImageConfig();
  } catch (e) {
    clog('ERROR', 'Failed to load image.config.json:', e?.message || e);
    process.exit(1);
  }
  jlog('INFO', { feeds: cfg.feeds, keywordsConfig: cfg.keywords, style: cfg.style, vibe: cfg.vibe });

  // Fetch headlines
  const t0 = performance.now();
  let headlines = [];
  try {
    headlines = await fetchHeadlines(cfg.feeds || []);
  } catch (e) {
    clog('ERROR', 'Fetching headlines failed:', e?.message || e);
  }
  const t1 = performance.now();
  clog('INFO', 'Fetched headlines', `count=${headlines.length}`, `ms=${Math.round(t1 - t0)}`);
  for (let i = 0; i < Math.min(5, headlines.length); i++) {
    clog('HEADLINE', headlines[i]);
  }

  // Extract keywords
  const keywords = extractKeywordsFromHeadlines(headlines, cfg.keywords || {});
  jlog('INFO', { keywords });

  if (!keywords.length) {
    clog('WARN', 'No keywords extracted. Continuing with fallback image generation.');
  }

  // Build base prompt and refine via OpenAI
  const basePrompt = buildPrompt({ keywords, cfg, date: new Date() });
  clog('INFO', 'Base prompt built:');
  clog('PROMPT', basePrompt);

  let refinedPrompt = basePrompt;
  if (env.OPENAI_API_KEY) {
    try {
      const { prompt: p, selectedStyle } = await refinePromptWithOpenAI({
        headlines,
        keywords,
        cfg,
        apiKey: env.OPENAI_API_KEY,
        model: cfg.openaiTextModel || process.env.OPENAI_MODEL || 'gpt-4.1',
        date: new Date()
      });
      refinedPrompt = p;
      clog('INFO', 'Refined prompt created via OpenAI');
      if (selectedStyle) clog('INFO', 'Random style selected:', selectedStyle);
      clog('PROMPT', refinedPrompt);
    } catch (e) {
      clog('WARN', 'OpenAI prompt refinement failed:', e?.message || e);
    }
  } else {
    clog('WARN', 'OPENAI_API_KEY absent; using base prompt without refinement');
  }

  // Generate/fetch image
  let buffer;
  let generator = 'fallback';
  const g0 = performance.now();
  if (process.env.GEMINI_API_KEY) {
    try {
      buffer = await generateWithGemini({
        prompt: refinedPrompt,
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || cfg.geminiModel,
        width: (cfg.resolution && cfg.resolution.width) || 2560,
        height: (cfg.resolution && cfg.resolution.height) || 1440
      });
      generator = (process.env.GEMINI_MODEL || cfg.geminiModel) + ' (gemini)';
      clog('INFO', 'Gemini image generated with model:', (process.env.GEMINI_MODEL || cfg.geminiModel));
    } catch (e) {
      clog('WARN', 'Gemini generation failed:', e?.message || e);
    }
  } else {
    clog('WARN', 'GEMINI_API_KEY absent; skipping Gemini generation');
  }
  if (!buffer) {
    try {
      buffer = await fallbackRandomImage(keywords, {
        width: (cfg.resolution && cfg.resolution.width) || 2560,
        height: (cfg.resolution && cfg.resolution.height) || 1440
      });
      generator = 'fallback';
      clog('INFO', 'Fallback image fetched');
    } catch (e) {
      clog('ERROR', 'Fallback image fetch failed:', e?.message || e);
      throw e;
    }
  }
  const g1 = performance.now();
  clog('INFO', `Image ready bytes=${buffer.length}`, `ms=${Math.round(g1 - g0)}`, `generator=${generator}`);

  // Save test image
  const outDir = path.resolve(process.cwd(), env.OUTPUT_DIR || 'output');
  await fsp.mkdir(outDir, { recursive: true });
  const imgPath = path.join(outDir, `test-background-${ts}.png`);
  await fsp.writeFile(imgPath, buffer);
  clog('INFO', 'Saved image', imgPath);

  // Apply wallpaper
  try {
    await setWallpaper(imgPath, env.DESKTOP_ENV);
    clog('INFO', 'Wallpaper set successfully', `desktopEnv=${env.DESKTOP_ENV}`);
  } catch (e) {
    clog('ERROR', 'Setting wallpaper failed:', e?.message || e);
  }

  // Summary
  const summary = {
    started: started.toISOString(),
    ended: new Date().toISOString(),
    node: process.version,
    desktopEnv: env.DESKTOP_ENV,
    outputDir: outDir,
    headlinesCount: headlines.length,
    topHeadlinesSample: headlines.slice(0, 5),
    keywords,
    basePrompt,
    refinedPrompt,
    generator,
    imagePath: imgPath,
    imageBytes: buffer.length
  };
  await fsp.writeFile(summaryFile, JSON.stringify(summary, null, 2));
  clog('INFO', 'Summary written', summaryFile);
  jlog('INFO', { summaryFile, imagePath: imgPath });

  clog('INFO', 'Test run complete.');
  out.end();
}

main().catch((err) => {
  console.error('[FATAL]', err?.stack || err?.message || err);
  process.exit(1);
});
