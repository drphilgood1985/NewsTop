import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from './util.js';
import dotenv from 'dotenv';

dotenv.config();

export async function loadImageConfig(cwd = process.cwd()) {
  const file = path.join(cwd, 'image.config.json');
  const raw = await fs.readFile(file, 'utf8');
  const cfg = JSON.parse(raw);
  return cfg;
}

export function envConfig() {
  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    DESKTOP_ENV: (process.env.DESKTOP_ENV || 'cinnamon').toLowerCase(),
    OUTPUT_DIR: process.env.OUTPUT_DIR || 'output'
  };
}

export function resolveOutputPath(baseDir, filename) {
  return path.join(baseDir, filename);
}

export function timestampSlug(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}${mm}${dd}-${hh}${mi}`;
}

