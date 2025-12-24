import { timeOfDayDescriptor } from './util.js';

// Uses OpenAI chat completions to produce a single, imagery-ready prompt
export async function refinePromptWithOpenAI({
  headlines = [],
  cfg,
  apiKey,
  model = 'gpt-4.1',
  date = new Date()
}) {
  const timeDesc = timeOfDayDescriptor(date);
  // Pick a random style from stylePool if available
  let selectedStyle = '';
  const pool = Array.isArray(cfg?.stylePool) ? cfg.stylePool : [];
  if (pool.length) selectedStyle = pool[Math.floor(Math.random() * pool.length)];

  const sys = [
    'You write compact, high-quality prompts for text-to-image models.',
    'Goal: turn today\'s headlines into a single desktop wallpaper prompt.',
    'Rules: 1-2 sentences, pick 1-3 concrete subjects, include time-of-day and style,',
    'end with "Avoid: ...", output only the prompt line.'
  ].join(' ');

  const userPayload = [
    `Time: ${timeDesc}`,
    cfg?.style ? `Style: ${cfg.style}` : '',
    cfg?.vibe ? `Vibe: ${cfg.vibe}` : '',
    selectedStyle ? `Randomized style: ${selectedStyle}` : '',
    cfg?.negative ? `Avoid terms: ${cfg.negative}` : '',
    'Headlines:',
    ...headlines.slice(0, 5)
  ].filter(Boolean).join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userPayload }
      ],
      max_tokens: 180
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI prompt refine error ${res.status}: ${text}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('OpenAI returned empty prompt content');
  return { prompt: content, selectedStyle };
}
