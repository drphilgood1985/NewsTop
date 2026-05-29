import { timeOfDayDescriptor } from './util.js';
import {
  buildEmbeddedHeadlineInstruction,
  buildEmbeddedHeadlineMetadata,
  ensureEmbeddedHeadlineInstruction,
  getEffectiveNegativePrompt,
  planEmbeddedHeadlineText,
  sanitizePromptForEmbeddedHeadlineText
} from './embeddedHeadlines.js';

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
  const headlineLimit = Number.isInteger(cfg?.headlinePromptLimit) ? cfg.headlinePromptLimit : 12;
  const selectedHeadlines = headlines.slice(0, headlineLimit);
  const embeddedHeadlineText = planEmbeddedHeadlineText(selectedHeadlines, cfg);
  const effectiveNegativePrompt = getEffectiveNegativePrompt(cfg?.negative || '', embeddedHeadlineText);
  const basePromptForModel = sanitizePromptForEmbeddedHeadlineText(basePrompt, embeddedHeadlineText);
  const embeddedInstruction = buildEmbeddedHeadlineInstruction(embeddedHeadlineText);

  const sys = [
    'You write compact prompts for a daily current-events desktop wallpaper.',
    'The image must visibly reflect the provided headlines, not just their mood.',
    'Pick 2-4 concrete headline-derived subjects, places, institutions, events, or objects from the input.',
    'Use recognizable editorial visual anchors and keep them tied to the headlines.',
    embeddedHeadlineText.enabled
      ? 'Do not avoid all text: only the provided exact headline excerpts may appear, and only as barely legible environmental texture. Do not invent, paraphrase, or add any other visible words.'
      : 'Avoid generic symbolism, unrelated scenes, readable text, logos, gore, and portrait likenesses of living public figures or celebrities.',
    'For named people, show contextual symbols such as buildings, documents, vehicles, crowds, flags, or locations instead of faces.',
    embeddedHeadlineText.enabled
      ? `Never use these headline text surfaces or props: ${embeddedHeadlineText.bannedSurfaces.join(', ')}.`
      : 'Do not use podiums, lecterns, stage backdrops, giant signage, train roof signs, or watermark overlays.',
    'Output one image prompt in 1-2 sentences, include the time-of-day and required style,',
    'and end with "Avoid: ...". Output only the prompt line.'
  ].join(' ');

  const userPayload = [
    `Time: ${timeDesc}`,
    cfg?.style ? `Style: ${cfg.style}` : '',
    cfg?.vibe ? `Vibe: ${cfg.vibe}` : '',
    selectedStyle ? `Required randomized art/photography style: ${selectedStyle}` : '',
    effectiveNegativePrompt ? `Avoid terms: ${effectiveNegativePrompt}` : '',
    embeddedInstruction ? `Embedded headline text requirements: ${embeddedInstruction}` : '',
    keywords.length ? `Extracted keywords: ${keywords.join(', ')}` : '',
    basePromptForModel ? `Keyword-based base prompt: ${basePromptForModel}` : '',
    'Headlines:',
    ...selectedHeadlines.map((headline, index) => `${index + 1}. ${headline}`)
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
      max_completion_tokens: 260
    })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`OpenAI prompt refine error ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const content = ensureEmbeddedHeadlineInstruction(
    json?.choices?.[0]?.message?.content?.trim(),
    embeddedHeadlineText
  );
  if (!content) throw new Error('OpenAI returned empty prompt content');
  return {
    prompt: content,
    selectedStyle,
    selectedHeadlines,
    embeddedHeadlineText: buildEmbeddedHeadlineMetadata(embeddedHeadlineText),
    effectiveNegativePrompt
  };
}
