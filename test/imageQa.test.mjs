import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildQaRetryPrompt,
  evaluateGeneratedImageWithOpenAI,
  normalizeQaResult
} from '../src/imageQa.openai.js';
import { generateOpenAIImageWithQa } from '../src/imageWorkflow.js';

const cfg = {
  openaiImageModel: 'gpt-image-2',
  openaiTextModel: 'gpt-5.4-mini',
  embeddedHeadlineText: {
    enabled: true,
    qaEnabled: true,
    retryOnReject: true
  }
};

const metadata = {
  embeddedHeadlineText: {
    enabled: true,
    snippets: ['US Iran deal'],
    bannedSurfaces: ['podium', 'lectern']
  }
};

test('normalizeQaResult maps the expected QA JSON shape', () => {
  const result = normalizeQaResult({
    pass: true,
    reasons: ['ok'],
    textSubtlety: 'barely_legible',
    badPropsDetected: [],
    headlineTextPresent: true,
    currentEventsStillPrimary: true
  });

  assert.equal(result.pass, true);
  assert.deepEqual(result.reasons, ['ok']);
  assert.equal(result.textSubtlety, 'barely_legible');
  assert.deepEqual(result.badPropsDetected, []);
  assert.equal(result.headlineTextPresent, true);
  assert.equal(result.currentEventsStillPrimary, true);
});

test('evaluateGeneratedImageWithOpenAI parses mocked JSON response', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    choices: [
      {
        message: {
          content: JSON.stringify({
            pass: false,
            reasons: ['text is dominant'],
            textSubtlety: 'dominant',
            badPropsDetected: ['podium'],
            headlineTextPresent: true,
            currentEventsStillPrimary: false
          })
        }
      }
    ]
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const result = await evaluateGeneratedImageWithOpenAI({
    imageBuffer: Buffer.from('not-a-real-image'),
    prompt: 'test prompt',
    metadata,
    apiKey: 'test-key',
    fetchImpl
  });

  assert.equal(result.pass, false);
  assert.deepEqual(result.badPropsDetected, ['podium']);
});

test('buildQaRetryPrompt makes headline text stricter and bans props', () => {
  const prompt = buildQaRetryPrompt(
    'A current events scene.',
    { reasons: ['podium detected'] },
    metadata.embeddedHeadlineText
  );

  assert.match(prompt, /podium detected/);
  assert.match(prompt, /US Iran deal/);
  assert.match(prompt, /barely legible/);
  assert.match(prompt, /podium, lectern/);
});

test('generateOpenAIImageWithQa does not retry when QA passes', async () => {
  let generateCalls = 0;
  let qaCalls = 0;

  const result = await generateOpenAIImageWithQa({
    prompt: 'prompt',
    apiKey: 'key',
    width: 10,
    height: 10,
    cfg,
    metadata,
    generateImage: async () => Buffer.from(`image-${++generateCalls}`),
    evaluateImage: async () => {
      qaCalls++;
      return { pass: true, reasons: [] };
    },
    appendLog: async () => {}
  });

  assert.equal(generateCalls, 1);
  assert.equal(qaCalls, 1);
  assert.equal(result.finalSelection, 'initial_passed');
  assert.equal(result.buffer.toString(), 'image-1');
});

test('generateOpenAIImageWithQa retries exactly once and selects retry when it passes', async () => {
  let generateCalls = 0;
  let qaCalls = 0;

  const result = await generateOpenAIImageWithQa({
    prompt: 'prompt',
    apiKey: 'key',
    width: 10,
    height: 10,
    cfg,
    metadata,
    generateImage: async () => Buffer.from(`image-${++generateCalls}`),
    evaluateImage: async () => {
      qaCalls++;
      return qaCalls === 1
        ? { pass: false, reasons: ['text too prominent'] }
        : { pass: true, reasons: [] };
    },
    appendLog: async () => {}
  });

  assert.equal(generateCalls, 2);
  assert.equal(qaCalls, 2);
  assert.equal(result.retryAttempted, true);
  assert.equal(result.finalSelection, 'retry_passed');
  assert.equal(result.buffer.toString(), 'image-2');
});

test('generateOpenAIImageWithQa keeps initial image when retry also fails', async () => {
  let generateCalls = 0;

  const result = await generateOpenAIImageWithQa({
    prompt: 'prompt',
    apiKey: 'key',
    width: 10,
    height: 10,
    cfg,
    metadata,
    generateImage: async () => Buffer.from(`image-${++generateCalls}`),
    evaluateImage: async () => ({ pass: false, reasons: ['bad props'] }),
    appendLog: async () => {}
  });

  assert.equal(generateCalls, 2);
  assert.equal(result.retryAttempted, true);
  assert.equal(result.finalSelection, 'initial_kept_after_retry_failed');
  assert.equal(result.buffer.toString(), 'image-1');
});
