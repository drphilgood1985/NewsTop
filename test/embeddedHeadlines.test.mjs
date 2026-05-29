import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEmbeddedHeadlineInstruction,
  ensureEmbeddedHeadlineInstruction,
  getEffectiveNegativePrompt,
  planEmbeddedHeadlineText,
  selectEmbeddedHeadlineText
} from '../src/embeddedHeadlines.js';

const cfg = {
  embeddedHeadlineText: {
    enabled: true,
    maxItems: 2,
    maxWordsPerExcerpt: 8,
    allowedSurfaces: ['newspaper', 'phone screen'],
    bannedSurfaces: ['podium', 'lectern']
  }
};

test('selectEmbeddedHeadlineText returns short unique snippets', () => {
  const snippets = selectEmbeddedHeadlineText([
    '',
    'US and Iran very close to deal but not there yet, Vance says - BBC News',
    'US and Iran very close to deal but not there yet, Vance says - BBC News',
    'Opportunities shrinking for too many young people, says major report on lost generation'
  ], cfg);

  assert.equal(snippets.length, 2);
  assert.equal(new Set(snippets.map(snippet => snippet.toLowerCase())).size, 2);
  assert.equal(snippets[0], 'US and Iran very close to deal');
  for (const snippet of snippets) {
    assert.ok(snippet.split(/\s+/).length <= 8);
    assert.doesNotMatch(snippet, /BBC News/i);
    assert.doesNotMatch(snippet, /\b(?:and|or|but|to|for|with|not)$/i);
  }
});

test('effective negative prompt removes generic text only when embedding is enabled', () => {
  const enabled = planEmbeddedHeadlineText(['US and Iran very close to deal'], cfg);
  const disabled = { enabled: false };

  assert.equal(
    getEffectiveNegativePrompt('text, watermark, logo, low-res', enabled),
    'watermark, logo, low-res'
  );
  assert.equal(
    getEffectiveNegativePrompt('text, watermark, logo, low-res', disabled),
    'text, watermark, logo, low-res'
  );
});

test('embedded instruction includes banned podium and lectern props', () => {
  const plan = planEmbeddedHeadlineText(['US and Iran very close to deal'], cfg);
  const instruction = buildEmbeddedHeadlineInstruction(plan);

  assert.match(instruction, /podium/);
  assert.match(instruction, /lectern/);
  assert.match(instruction, /environmental texture/);
});

test('ensureEmbeddedHeadlineInstruction inserts snippets before Avoid clause', () => {
  const plan = planEmbeddedHeadlineText(['US and Iran very close to deal'], cfg);
  const prompt = ensureEmbeddedHeadlineInstruction(
    'Sunset over a tense diplomatic scene. Avoid: text, watermark, logo.',
    plan
  );

  assert.match(prompt, /US and Iran very close to deal/);
  assert.match(prompt, /environmental texture/);
  assert.doesNotMatch(prompt, /Avoid: text,/);
  assert.match(prompt, /Avoid: watermark, logo/);
});

test('ensureEmbeddedHeadlineInstruction removes unauthorized quoted text', () => {
  const plan = planEmbeddedHeadlineText(['US and Iran very close to deal'], cfg);
  const prompt = ensureEmbeddedHeadlineInstruction(
    'A newsstand shows “Made up extra words” beside the scene. Avoid: text, watermark.',
    plan
  );

  assert.doesNotMatch(prompt, /Made up extra words/);
  assert.match(prompt, /US and Iran very close to deal/);
});
