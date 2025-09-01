import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, log, writeFileAtomic } from './util.js';

async function fetchBuffer(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

export async function generateWithOpenAI({ prompt, apiKey, width = 1920, height = 1080 }) {
  const model = 'gpt-image-1';
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      prompt,
      size: `${width}x${height}`
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
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

export async function saveImage(buffer, outDir, filenameBase = 'background', ext = 'png') {
  await ensureDir(outDir);
  const file = path.join(outDir, `${filenameBase}.${ext}`);
  await writeFileAtomic(file, buffer);
  return file;
}
