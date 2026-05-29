const DEFAULT_ALLOWED_SURFACES = [
  'newspaper',
  'phone screen',
  'transit display',
  'distant billboard',
  'ticker strip',
  'cafe menu',
  'luggage tag',
  'small poster',
  'protest placard'
];

const DEFAULT_BANNED_SURFACES = [
  'podium',
  'lectern',
  'stage backdrop',
  'giant foreground billboard',
  'train roof sign',
  'logo',
  'watermark overlay',
  'plane banner',
  'dominant marquee'
];

const SOURCE_TRAILER = /\s+(?:[-|]\s*)?(?:BBC News|Reuters|The New York Times|NYT|AP News|Associated Press|CNN|NPR|The Guardian)$/i;
const ATTRIBUTION_PHRASE = /\s*,?\s+(?:[A-Z][a-z]+|official|minister|police|court|report)\s+(?:says|said|warns|warned|claims|claimed)$/i;
const WEAK_TRAILING_WORDS = new Set(['and', 'or', 'but', 'to', 'for', 'with', 'not']);

function uniqueList(value, fallback) {
  const list = Array.isArray(value) && value.length ? value : fallback;
  return Array.from(new Set(list.map(item => String(item || '').trim()).filter(Boolean)));
}

export function resolveEmbeddedHeadlineConfig(cfg = {}) {
  const raw = cfg?.embeddedHeadlineText || {};
  return {
    enabled: raw.enabled === true,
    maxItems: Number.isInteger(raw.maxItems) && raw.maxItems > 0 ? raw.maxItems : 2,
    maxWordsPerExcerpt: Number.isInteger(raw.maxWordsPerExcerpt) && raw.maxWordsPerExcerpt > 0
      ? raw.maxWordsPerExcerpt
      : 8,
    readability: raw.readability || 'barely_legible',
    placement: raw.placement || 'scene_native',
    qaEnabled: raw.qaEnabled !== false,
    retryOnReject: raw.retryOnReject !== false,
    allowedSurfaces: uniqueList(raw.allowedSurfaces, DEFAULT_ALLOWED_SURFACES),
    bannedSurfaces: uniqueList(raw.bannedSurfaces, DEFAULT_BANNED_SURFACES)
  };
}

function normalizeHeadlineText(headline) {
  return String(headline || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(SOURCE_TRAILER, '')
    .replace(ATTRIBUTION_PHRASE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^['"“”‘’]+|['"“”‘’]+$/g, '');
}

function splitHeadlineForExcerpt(headline) {
  return headline
    .split(/\s+(?:[-–—:;]|\|)\s+/)
    .map(part => part.trim())
    .filter(Boolean)
    .sort((a, b) => {
      const aWords = a.split(/\s+/).length;
      const bWords = b.split(/\s+/).length;
      const aFits = aWords <= 8 ? 0 : 1;
      const bFits = bWords <= 8 ? 0 : 1;
      if (aFits !== bFits) return aFits - bFits;
      return Math.abs(aWords - 6) - Math.abs(bWords - 6);
    });
}

function toExcerpt(headline, maxWords) {
  const normalized = normalizeHeadlineText(headline);
  if (!normalized) return '';

  const candidate = splitHeadlineForExcerpt(normalized)[0] || normalized;
  const words = candidate
    .replace(/[^\p{L}\p{N}'£$€%-]+/gu, ' ')
    .split(/\s+/)
    .map(word => word.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
  if (words.length < 2) return '';
  const excerptWords = words.slice(0, maxWords);
  while (excerptWords.length > 2 && WEAK_TRAILING_WORDS.has(excerptWords.at(-1).toLowerCase())) {
    excerptWords.pop();
  }
  return excerptWords.join(' ');
}

export function selectEmbeddedHeadlineText(headlines = [], cfg = {}) {
  const options = resolveEmbeddedHeadlineConfig(cfg);
  if (!options.enabled) return [];

  const snippets = [];
  const seen = new Set();
  for (const headline of headlines) {
    const snippet = toExcerpt(headline, options.maxWordsPerExcerpt);
    const key = snippet.toLowerCase();
    if (!snippet || seen.has(key)) continue;
    seen.add(key);
    snippets.push(snippet);
    if (snippets.length >= options.maxItems) break;
  }
  return snippets;
}

export function planEmbeddedHeadlineText(headlines = [], cfg = {}) {
  const options = resolveEmbeddedHeadlineConfig(cfg);
  const snippets = selectEmbeddedHeadlineText(headlines, cfg);
  return {
    ...options,
    enabled: options.enabled && snippets.length > 0,
    snippets
  };
}

export function getEffectiveNegativePrompt(negative = '', embeddedHeadlineText = {}) {
  const terms = String(negative || '')
    .split(',')
    .map(term => term.trim())
    .filter(Boolean);

  const filtered = embeddedHeadlineText?.enabled
    ? terms.filter(term => !/^text$/i.test(term) && !/^readable text$/i.test(term))
    : terms;

  return filtered.join(', ');
}

export function sanitizePromptForEmbeddedHeadlineText(prompt = '', embeddedHeadlineText = {}) {
  if (!embeddedHeadlineText?.enabled) return prompt;
  return String(prompt || '').replace(/Avoid:\s*([^.]*)\./i, (_match, terms) => {
    const next = getEffectiveNegativePrompt(terms, embeddedHeadlineText);
    return next ? `Avoid: ${next}.` : '';
  }).replace(/\s+/g, ' ').trim();
}

export function buildEmbeddedHeadlineInstruction(embeddedHeadlineText = {}) {
  if (!embeddedHeadlineText.enabled || !embeddedHeadlineText.snippets?.length) return '';

  const quotedSnippets = embeddedHeadlineText.snippets.map(snippet => `"${snippet}"`).join(', ');
  return [
    `Embed exactly ${embeddedHeadlineText.snippets.length} short headline excerpt(s): ${quotedSnippets}.`,
    'Do not invent, paraphrase, or add any other visible words.',
    'Treat headline text as environmental texture, not the subject.',
    `Make the text ${embeddedHeadlineText.readability.replace(/_/g, ' ')}: visible only when inspecting closely, not readable from normal desktop distance.`,
    `Use only small scene-native surfaces: ${embeddedHeadlineText.allowedSurfaces.join(', ')}.`,
    `Never use these surfaces or props: ${embeddedHeadlineText.bannedSurfaces.join(', ')}.`,
    'Keep the current-events scene and randomized art/photography style as the main visual focus.'
  ].join(' ');
}

function removeUnauthorizedQuotedText(prompt, embeddedHeadlineText) {
  const allowed = new Set((embeddedHeadlineText.snippets || []).map(snippet => snippet.trim()));
  return String(prompt || '').replace(/["“]([^"”]{2,160})["”]/g, (match, inner) => {
    const normalized = inner.trim();
    return allowed.has(normalized) ? `"${normalized}"` : 'a barely legible ambient headline fragment';
  });
}

export function ensureEmbeddedHeadlineInstruction(prompt = '', embeddedHeadlineText = {}) {
  const instruction = buildEmbeddedHeadlineInstruction(embeddedHeadlineText);
  if (!instruction) return prompt;

  const cleanedPrompt = removeUnauthorizedQuotedText(prompt, embeddedHeadlineText);
  const missingSnippet = embeddedHeadlineText.snippets.some(snippet => !cleanedPrompt.includes(snippet));
  const missingSubtlety = !/environmental texture|barely legible|background detail/i.test(prompt);
  if (!missingSnippet && !missingSubtlety) return sanitizePromptForEmbeddedHeadlineText(cleanedPrompt, embeddedHeadlineText);

  const sanitized = sanitizePromptForEmbeddedHeadlineText(cleanedPrompt, embeddedHeadlineText);
  const avoidIndex = sanitized.lastIndexOf('Avoid:');
  if (avoidIndex === -1) return `${sanitized} ${instruction}`.trim();

  const beforeAvoid = sanitized.slice(0, avoidIndex).trim();
  const avoid = sanitized.slice(avoidIndex).trim();
  return `${beforeAvoid} ${instruction} ${avoid}`.replace(/\s+/g, ' ').trim();
}

export function buildEmbeddedHeadlineMetadata(embeddedHeadlineText = {}) {
  return {
    enabled: Boolean(embeddedHeadlineText.enabled),
    snippets: embeddedHeadlineText.snippets || [],
    readability: embeddedHeadlineText.readability,
    placement: embeddedHeadlineText.placement,
    allowedSurfaces: embeddedHeadlineText.allowedSurfaces || [],
    bannedSurfaces: embeddedHeadlineText.bannedSurfaces || []
  };
}
