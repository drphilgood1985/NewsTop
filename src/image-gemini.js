// Generate an image using Google AI APIs. Tries Images API first, then models:generateContent fallback.

async function tryImagesGenerate({ prompt, apiKey, model, width, height }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/images:generate?key=${encodeURIComponent(apiKey)}`;
  const body = {
    model,
    prompt: { text: prompt },
    size: `${width}x${height}`
  };
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

async function tryModelsGenerateContent({ prompt, apiKey, model, width, height }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: `${prompt}\n\nGenerate a ${width}x${height} PNG wallpaper. Return only the image as inline data.` }
        ]
      }
    ],
    generationConfig: { temperature: 0.8 }
  };
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

export async function generateWithGemini({ prompt, apiKey, model, width = 2560, height = 1440 }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is required for Gemini image generation');
  if (!model) throw new Error('image.config.json geminiModel is required');

  const isGeminiFamily = /^gemini[-:]/i.test(model) || model.includes('gemini');
  const primary = isGeminiFamily ? 'models' : 'images';

  if (primary === 'models') {
    try {
      return await tryModelsGenerateContent({ prompt, apiKey, model, width, height });
    } catch (e1) {
      try {
        return await tryImagesGenerate({ prompt, apiKey, model, width, height });
      } catch (e2) {
        const msg = `Gemini generation failed: ${e1?.message || e1} | fallback: ${e2?.message || e2}`;
        const err = new Error(msg);
        err.cause = { primary: e1, fallback: e2 };
        throw err;
      }
    }
  } else {
    try {
      return await tryImagesGenerate({ prompt, apiKey, model, width, height });
    } catch (e1) {
      try {
        return await tryModelsGenerateContent({ prompt, apiKey, model, width, height });
      } catch (e2) {
        const msg = `Gemini generation failed: ${e1?.message || e1} | fallback: ${e2?.message || e2}`;
        const err = new Error(msg);
        err.cause = { primary: e1, fallback: e2 };
        throw err;
      }
    }
  }
}
