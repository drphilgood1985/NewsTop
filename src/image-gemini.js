// Generate an image using Google AI APIs. Tries Images API first, then models:generateContent fallback.
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

async function tryImagesGenerate({ prompt, apiKey, model, width, height, logSource }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/images:generate?key=${encodeURIComponent(apiKey)}`;
  const body = {
    model,
    prompt: { text: prompt },
    size: `${width}x${height}`
  };
  if (logSource) {
    await logPromptLine({ endpoint: 'images:generate', model, width, height, text: body.prompt.text, source: logSource });
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Gemini Images API error ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const b64 = json?.images?.[0]?.data?.b64 || json?.images?.[0]?.b64 || json?.candidates?.[0]?.image?.b64;
  if (!b64) throw new Error('Gemini Images API: missing image data');
  return Buffer.from(b64, 'base64');
}

async function tryModelsGenerateContent({ prompt, apiKey, model, width, height, logSource }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const textToSend = `${prompt}\n\nGenerate a ${width}x${height} PNG wallpaper. Return only the image as inline data.`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: textToSend }
        ]
      }
    ],
    generationConfig: { temperature: 0.8 }
  };
  if (logSource) {
    await logPromptLine({ endpoint: 'models:generateContent', model, width, height, text: textToSend, source: logSource });
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Gemini models API error ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  // Look for inline image data
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const inline = parts.find(p => (p.inlineData && p.inlineData.data) || (p.inline_data && p.inline_data.data));
  if (!inline) throw new Error('Gemini models API: missing inline image data');
  const data = inline.inlineData?.data || inline.inline_data?.data;
  return Buffer.from(data, 'base64');
}

export async function generateWithGemini({ prompt, apiKey, model, width = 2560, height = 1440, logSource }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is required for Gemini image generation');
  if (!model) throw new Error('image.config.json geminiModel is required');

  const isGeminiFamily = /^gemini[-:]/i.test(model) || model.includes('gemini');
  // Prefer Images API if the model name suggests image-generation or preview variants
  const looksLikeImageModel = /imagen|image|preview/i.test(model);
  const primary = looksLikeImageModel ? 'images' : (isGeminiFamily ? 'models' : 'images');

  if (primary === 'models') {
    try {
      return await tryModelsGenerateContent({ prompt, apiKey, model, width, height, logSource });
    } catch (e1) {
      try {
        return await tryImagesGenerate({ prompt, apiKey, model, width, height, logSource });
      } catch (e2) {
        const msg = `Gemini generation failed: ${e1?.message || e1} | fallback: ${e2?.message || e2}`;
        const err = new Error(msg);
        err.cause = { primary: e1, fallback: e2 };
        throw err;
      }
    }
  } else {
    try {
      return await tryImagesGenerate({ prompt, apiKey, model, width, height, logSource });
    } catch (e1) {
      try {
        return await tryModelsGenerateContent({ prompt, apiKey, model, width, height, logSource });
      } catch (e2) {
        const msg = `Gemini generation failed: ${e1?.message || e1} | fallback: ${e2?.message || e2}`;
        const err = new Error(msg);
        err.cause = { primary: e1, fallback: e2 };
        throw err;
      }
    }
  }
}
