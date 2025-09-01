import fs from 'node:fs/promises';
import path from 'node:path';

export function log(...args) {
  if (process.env.DEBUG) console.log('[DEBUG]', ...args);
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export function nowLocal() {
  return new Date();
}

export function timeOfDayDescriptor(date = nowLocal()) {
  const h = date.getHours();
  if (h < 6) return 'pre-dawn night';
  if (h < 11) return 'morning golden light';
  if (h < 14) return 'midday bright daylight';
  if (h < 18) return 'afternoon warm light';
  if (h < 21) return 'sunset dusk glow';
  return 'night cool tones';
}

export function toFileUri(absPath) {
  const p = path.resolve(absPath);
  return 'file://' + p.replace(/ /g, '%20');
}

export async function writeFileAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = path.join(dir, '.tmp-' + path.basename(filePath));
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, filePath);
}

export function joinUniqueWords(words, max = 10) {
  const unique = Array.from(new Set(words.map(w => w.toLowerCase())));
  return unique.slice(0, max).join(', ');
}

