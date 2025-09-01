import { timeOfDayDescriptor } from './util.js';

export function buildPrompt({ keywords, cfg, date = new Date() }) {
  const timeStr = timeOfDayDescriptor(date);
  const kw = keywords.join(', ');
  const artistHints = Array.isArray(cfg.artistHints) && cfg.artistHints.length
    ? cfg.artistHints[Math.floor(Math.random() * cfg.artistHints.length)]
    : '';

  const positive = [
    `A visually striking wallpaper evoking: ${kw}.`,
    `Atmosphere/time: ${timeStr}.`,
    cfg.style ? `Style: ${cfg.style}.` : '',
    cfg.vibe ? `Vibe: ${cfg.vibe}.` : '',
    artistHints ? artistHints + '.' : ''
  ].filter(Boolean).join(' ');

  const negative = cfg.negative ? `Avoid: ${cfg.negative}.` : '';

  return `${positive} ${negative}`.trim();
}

