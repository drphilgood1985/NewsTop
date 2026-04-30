// Generate an image using Google AI APIs.
import path from 'node:path';
import { ensureDir, appendJsonLine } from './util.js';

async function logPromptLine({ endpoint, model, width, height, text, source }) {
  try {
    const logsDir = path.resolve(process.cwd(), 'logs');
    await ensureDir(logsDir);
    await appendJsonLine(path.join(logsDir, 'prompts.log'), {
      ts: new Date().toISOString(),
      source: source || 'unknown',
      endpoint,
      model,
      resolution: { width, height },
      prompt: text
    });
  } catch {
    // best-effort logging; ignore failures
  }
}

function closestAspectRatio(width, height) {
  const aspect = width && height ? width / height : 16 / 9;
  const candidates = [
    { value: '1:1', ratio: 1 },
    { value: '4:3', ratio: 4 / 3 },
    { value: '3:4', ratio: 3 / 4 },
    { value: '16:9', ratio: 16 / 9 },
    { value: '9:16', ratio: 9 / 16 }
  ];
  return candidates
    .map(candidate => ({
      ...candidate,
      distance: Math.abs(Math.log(aspect / candidate.ratio))
    }))
    .sort((a, b) => a.distance - b.distance)[0].value;
}

function extractInlineImage(json) {
  const candidates = json?.candidates || [];
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts || [];
    const inline = parts.find(part => (
      part?.inlineData?.data ||
      part?.inline_data?.data
    ));
    const data = inline?.inlineData?.data || inline?.inline_data?.data;
    if (data) return data;
  }
  return '';
}

function extractPredictionImage(json) {
  const predictions = json?.predictions || [];
  for (const prediction of predictions) {
    const data =
      prediction?.bytesBase64Encoded ||
      prediction?.image?.bytesBase64Encoded ||
      prediction?.image?.imageBytes ||
      prediction?.imageBytes;
    if (data) return data;
  }
  return '';
}

async function tryGeminiGenerateContent({ prompt, apiKey, model, width, height, logSource }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const textToSend = `${prompt}\n\nGenerate a ${closestAspectRatio(width, height)} desktop wallpaper image. Return image data.`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: textToSend }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE']
    }
  };
  if (logSource) {
    await logPromptLine({ endpoint: 'models:generateContent', model, width, height, text: textToSend, source: logSource });
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Gemini models API error ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const b64 = extractInlineImage(json);
  if (!b64) throw new Error('Gemini models API: missing inline image data');
  return Buffer.from(b64, 'base64');
}

async function tryImagenPredict({ prompt, apiKey, model, width, height, logSource }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:predict`;
  const parameters = {
    sampleCount: 1,
    aspectRatio: closestAspectRatio(width, height)
  };
  if (/^imagen-4\.0-(generate|ultra)-001$/i.test(model) && Math.max(width, height) >= 1920) {
    parameters.imageSize = '2K';
  }
  const body = {
    instances: [
      {
        prompt
      }
    ],
    parameters
  };
  if (logSource) {
    await logPromptLine({ endpoint: 'models:predict', model, width, height, text: prompt, source: logSource });
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Imagen API error ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const data = extractPredictionImage(json);
  if (!data) throw new Error('Imagen API: missing image data');
  return Buffer.from(data, 'base64');
}

export async function generateWithGemini({ prompt, apiKey, model = 'gemini-2.5-flash-image', width = 2560, height = 1440, logSource }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is required for Gemini image generation');
  if (/^imagen-/i.test(model)) {
    return tryImagenPredict({ prompt, apiKey, model, width, height, logSource });
  }
  return tryGeminiGenerateContent({ prompt, apiKey, model, width, height, logSource });
}
