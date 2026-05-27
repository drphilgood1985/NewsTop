import fs from 'node:fs/promises';
import path from 'node:path';
import { appendJsonLine, ensureDir, log, writeFileAtomic } from './util.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

async function logPromptLine({ endpoint, model, width, height, size, text, source }) {
  try {
    const logsDir = path.resolve(process.cwd(), 'logs');
    await ensureDir(logsDir);
    await appendJsonLine(path.join(logsDir, 'prompts.log'), {
      ts: new Date().toISOString(),
      source: source || 'unknown',
      endpoint,
      model,
      resolution: { width, height },
      size,
      prompt: text
    });
  } catch {
    // best-effort logging; ignore failures
  }
}

async function fetchBuffer(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

function resolveOpenAISize(width, height) {
  const DEFAULT = '1024x1024';
  if (!width || !height) return DEFAULT;

  const requested = `${width}x${height}`;
  if (requested === '1024x1024' || requested === '1024x1536' || requested === '1536x1024') {
    return requested;
  }

  const aspect = width / height;
  if (Math.abs(aspect - 1) < 0.2) return '1024x1024';
  if (aspect > 1) return '1536x1024';
  return '1024x1536';
}

export async function generateWithOpenAI({
  prompt,
  apiKey,
  model = 'gpt-image-1',
  width = 1920,
  height = 1080,
  logSource
}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for OpenAI image generation');
  if (!model) throw new Error('OpenAI image model is required for image generation');

  const size = resolveOpenAISize(width, height);
  if (logSource) {
    await logPromptLine({
      endpoint: 'images:generations',
      model,
      width,
      height,
      size,
      text: prompt,
      source: logSource
    });
  }

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      prompt,
      size
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`OpenAI API error ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI response missing image data');
  return Buffer.from(b64, 'base64');
}

export async function fallbackRandomImage(keywords, { width = 1920, height = 1080 } = {}) {
  // Multi-fallback chain: Unsplash -> LoremFlickr -> Picsum (seeded)
  const words = (keywords || []).slice(0, 5);
  const query = encodeURIComponent(words.join(','));

  const attempts = [
    { name: 'unsplash', url: `https://source.unsplash.com/${width}x${height}/?${query}`, opts: { redirect: 'follow' } },
    { name: 'loremflickr', url: `https://loremflickr.com/${width}/${height}/${query}`, opts: { redirect: 'follow' } },
    { name: 'picsum', url: `https://picsum.photos/seed/${Date.now()}/${width}/${height}`, opts: {} }
  ];

  let lastErr;
  for (const attempt of attempts) {
    try {
      log('Fallback attempt:', attempt.name, attempt.url);
      return await fetchBuffer(attempt.url, attempt.opts);
    } catch (e) {
      lastErr = e;
      log(`Fallback ${attempt.name} failed:`, e.message);
    }
  }
  throw lastErr || new Error('All fallback image sources failed');
}

export async function pickRandomImageFromDir(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()));
  if (!files.length) return null;
  const name = files[Math.floor(Math.random() * files.length)];
  return path.join(dir, name);
}

export async function saveImage(buffer, outDir, filenameBase = 'background', ext = 'png') {
  await ensureDir(outDir);
  const file = path.join(outDir, `${filenameBase}.${ext}`);
  await writeFileAtomic(file, buffer);
  return file;
}
