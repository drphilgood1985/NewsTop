function parseJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('QA response was empty');
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('QA response did not contain JSON');
    return JSON.parse(match[0]);
  }
}

export function normalizeQaResult(value = {}) {
  const reasons = Array.isArray(value.reasons)
    ? value.reasons.map(reason => String(reason || '').trim()).filter(Boolean)
    : [];

  const badPropsDetected = Array.isArray(value.badPropsDetected)
    ? value.badPropsDetected.map(prop => String(prop || '').trim()).filter(Boolean)
    : (value.badPropsDetected ? [String(value.badPropsDetected)] : []);

  return {
    pass: value.pass === true,
    reasons,
    textSubtlety: String(value.textSubtlety || 'unknown'),
    badPropsDetected,
    headlineTextPresent: value.headlineTextPresent === true,
    currentEventsStillPrimary: value.currentEventsStillPrimary === true
  };
}

export function buildQaRetryPrompt(prompt, qaResult = {}, embeddedHeadlineText = {}) {
  const reasons = Array.isArray(qaResult.reasons) && qaResult.reasons.length
    ? qaResult.reasons.join('; ')
    : 'ambient headline text was not subtle enough or the composition drifted';
  const snippets = Array.isArray(embeddedHeadlineText.snippets) && embeddedHeadlineText.snippets.length
    ? embeddedHeadlineText.snippets.map(snippet => `"${snippet}"`).join(', ')
    : 'the selected headline snippets';
  const banned = Array.isArray(embeddedHeadlineText.bannedSurfaces) && embeddedHeadlineText.bannedSurfaces.length
    ? embeddedHeadlineText.bannedSurfaces.join(', ')
    : 'podiums, lecterns, giant signs, watermark overlays, plane banners';

  return [
    prompt,
    'Retry revision:',
    `Fix these QA issues: ${reasons}.`,
    `Keep headline excerpts ${snippets} tiny, partially obscured, and barely legible on small scene-native background surfaces only.`,
    `Do not use ${banned}.`,
    'The current-events scene must remain the focus; embedded text must read as environmental texture.'
  ].join(' ');
}

export async function evaluateGeneratedImageWithOpenAI({
  imageBuffer,
  prompt,
  metadata = {},
  apiKey,
  model = 'gpt-5.4-mini',
  fetchImpl = fetch
}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for image QA');
  if (!imageBuffer) throw new Error('imageBuffer is required for image QA');

  const embeddedHeadlineText = metadata.embeddedHeadlineText || {};
  const snippets = Array.isArray(embeddedHeadlineText.snippets) ? embeddedHeadlineText.snippets : [];
  const bannedSurfaces = Array.isArray(embeddedHeadlineText.bannedSurfaces)
    ? embeddedHeadlineText.bannedSurfaces
    : [];

  const qaPrompt = [
    'Evaluate this generated desktop wallpaper for subtle embedded headline text.',
    'Return only valid JSON with keys: pass, reasons, textSubtlety, badPropsDetected, headlineTextPresent, currentEventsStillPrimary.',
    'Pass only if any headline text is ambient/background detail, barely legible, and not the focal point.',
    'Pass only if the scene still primarily reflects the current-events prompt.',
    `Selected headline snippets: ${snippets.map(snippet => `"${snippet}"`).join(', ') || 'none'}.`,
    `Banned props/surfaces: ${bannedSurfaces.join(', ') || 'podium, lectern, giant signage, watermark overlay'}.`,
    `Prompt used: ${prompt}`
  ].join('\n');

  const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a strict visual QA reviewer for generated current-events wallpapers.'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: qaPrompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${Buffer.from(imageBuffer).toString('base64')}`,
                detail: 'low'
              }
            }
          ]
        }
      ],
      max_completion_tokens: 350
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`OpenAI image QA error ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  return normalizeQaResult(parseJsonObject(content));
}
