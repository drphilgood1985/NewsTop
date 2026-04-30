import { timeOfDayDescriptor } from './util.js';

function extractText(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts
    .map(part => part?.text || '')
    .filter(Boolean)
    .join('')
    .trim();
}

// Uses Gemini text generation to produce a single, imagery-ready prompt.
export async function refinePromptWithGemini({
  headlines = [],
  cfg,
  apiKey,
  model = 'gemini-2.5-flash',
  date = new Date()
}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is required for Gemini prompt refinement');
  if (!model) throw new Error('Gemini text model is required for prompt refinement');

  const timeDesc = timeOfDayDescriptor(date);
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: sys }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPayload }]
        }
      ],
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 180
      }
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini prompt refine error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const content = extractText(json);
  if (!content) throw new Error('Gemini returned empty prompt content');
  return { prompt: content, selectedStyle };
}
