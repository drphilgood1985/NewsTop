import { timeOfDayDescriptor } from './util.js';

// Uses OpenAI chat completions to produce a single, imagery-ready prompt
export async function refinePromptWithOpenAI({
  headlines = [],
  keywords = [],
  cfg,
  apiKey,
  model = 'gpt-4.1',
  date = new Date(),
  customPrompt = '',
  basePrompt = ''
}) {
  const timeDesc = timeOfDayDescriptor(date);
  // Pick a random style from stylePool if available
  let selectedStyle = '';
  const pool = Array.isArray(cfg?.stylePool) ? cfg.stylePool : [];
  if (pool.length) selectedStyle = pool[Math.floor(Math.random() * pool.length)];

  const sys = [
    'You are an elite prompt writer for text-to-image models.',
    'Task: craft ONE final imagery prompt for a desktop wallpaper.',
    'Requirements:',
    '- Be concise but evocative (1–3 sentences).',
    '- Incorporate the supplied keywords/themes and time-of-day.',
    '- When a custom prompt is supplied, treat it as the centerpiece and elevate it with cinematic/painterly detail.',
    '- Infer tasteful references to modern or classic pop culture (film, TV, music, games, literature, design) when they complement the concept; avoid direct quotes or trademarked slogans.',
    '- Select 1–3 concrete subjects (people, places, or objects) from the themes/headlines to feature prominently as focal points; compose the scene around them.',
    '- Weave in the provided style/vibe and the randomly chosen art/photography style.',
    '- Include a short, compact negative prompt at the end prefixed with "Avoid:".',
    '- Do NOT include any other text, labels, or formatting.',
    'Output ONLY the final prompt line.'
  ].join(' ');

  const userPayload = {
    timeOfDay: timeDesc,
    keywords,
    style: cfg?.style || '',
    vibe: cfg?.vibe || '',
    selectedStyle,
    negative: cfg?.negative || '',
    headlineSamples: headlines.slice(0, 8),
    customPrompt,
    basePrompt
  };

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
        { role: 'user', content: JSON.stringify(userPayload) }
      ]
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
