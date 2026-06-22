import { timeOfDayDescriptor } from './util.js';

const DEFAULT_HEADLINE_LIMIT = 5;
const DEFAULT_HEADLINE_MAX_CHARS = 110;

function resolvePositiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function compactHeadline(headline, maxChars = DEFAULT_HEADLINE_MAX_CHARS) {
  const limit = Math.max(8, maxChars);
  const text = String(headline || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text || text.length <= limit) return text;
  const trimmed = text.slice(0, limit - 3).replace(/\s+\S*$/, '').trim();
  return `${trimmed || text.slice(0, limit - 3)}...`;
}

// Uses OpenAI text generation to produce a single, imagery-ready prompt.
export async function refinePromptWithOpenAI({
  headlines = [],
  keywords = [],
  basePrompt = '',
  cfg,
  apiKey,
  model = 'gpt-5.4-mini',
  date = new Date()
}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for OpenAI prompt refinement');
  if (!model) throw new Error('OpenAI text model is required for prompt refinement');

  const timeDesc = timeOfDayDescriptor(date);
  let selectedStyle = '';
  const pool = Array.isArray(cfg?.stylePool) ? cfg.stylePool : [];
  if (pool.length) selectedStyle = pool[Math.floor(Math.random() * pool.length)];
  const headlineLimit = resolvePositiveInteger(cfg?.headlinePromptLimit, DEFAULT_HEADLINE_LIMIT);
  const headlineMaxChars = resolvePositiveInteger(cfg?.headlineMaxChars, DEFAULT_HEADLINE_MAX_CHARS);
  const selectedHeadlines = headlines.slice(0, headlineLimit);
  const headlineSignals = selectedHeadlines
    .map(headline => compactHeadline(headline, headlineMaxChars))
    .filter(Boolean);
  const effectiveNegativePrompt = cfg?.negative || '';
  const basePromptForModel = basePrompt;

  const sys = [
    'You write compact image prompts for current events rendered as museum-grade fine art.',
    'Start from the lived reality of the headline cues: place, weather, public consequence, private emotion, tension, loss, hope, or uncertainty.',
    'Create one emotionally legible scene that feels current first and artful second.',
    'If the required style is photographic, make it fine-art photography: composed, intentional, emotionally resonant, and gallery-worthy, never a literal press photo.',
    'Use 1-2 headline-derived motifs only when they deepen the feeling; avoid poster symbolism and decorative abstraction.',
    'Use headline cues as private source material only; do not quote, paraphrase, display, or describe headline text.',
    'The final image must be pure imagery: no readable words, letters, captions, labels, tickers, newspaper front pages, screens of text, or text-bearing banners.',
    'For named people, show contextual symbols such as buildings, documents, vehicles, crowds, flags, or locations instead of faces.',
    'Do not use podiums, lecterns, stage backdrops, giant signage, train roof signs, infographics, collage, newspapers, phones, or watermark overlays.',
    'Make the viewer feel something before they decode the news reference.',
    'Output one image prompt under 90 words. Include the time-of-day and required style. End with "Avoid: ...". Output only the prompt line.'
  ].join(' ');

  const artDirection = [
    cfg?.style ? `style: ${cfg.style}` : '',
    cfg?.vibe ? `vibe: ${cfg.vibe}` : '',
    selectedStyle ? `required style: ${selectedStyle}` : ''
  ].filter(Boolean).join('; ');

  const userPayload = [
    `Time: ${timeDesc}`,
    artDirection ? `Art direction: ${artDirection}` : '',
    effectiveNegativePrompt ? `Avoid terms: ${effectiveNegativePrompt}` : '',
    keywords.length ? `Extracted keywords: ${keywords.join(', ')}` : '',
    basePromptForModel ? `Base prompt: ${basePromptForModel}` : '',
    headlineSignals.length ? `Private current-event cues, not visual text: ${headlineSignals.map((headline, index) => `${index + 1}. ${headline}`).join(' | ')}` : ''
  ].filter(Boolean).join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userPayload }
      ],
      max_completion_tokens: 180
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`OpenAI prompt refine error ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('OpenAI returned empty prompt content');
  return {
    prompt: content,
    selectedStyle,
    selectedHeadlines,
    effectiveNegativePrompt
  };
}
