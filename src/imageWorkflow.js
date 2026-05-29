import { appendPromptLog, generateWithOpenAI } from './image.js';
import { buildQaRetryPrompt, evaluateGeneratedImageWithOpenAI } from './imageQa.openai.js';
import { resolveEmbeddedHeadlineConfig } from './embeddedHeadlines.js';

function shouldRunQa(cfg, metadata) {
  const embeddedConfig = resolveEmbeddedHeadlineConfig(cfg);
  return Boolean(
    embeddedConfig.qaEnabled &&
    metadata?.embeddedHeadlineText?.enabled &&
    metadata.embeddedHeadlineText.snippets?.length
  );
}

async function appendSelectionLog({
  appendLog,
  source,
  model,
  width,
  height,
  prompt,
  metadata,
  qaResult,
  retryQaResult,
  retryAttempted,
  finalSelection,
  qaError
}) {
  await appendLog({
    source,
    endpoint: 'image:selection',
    model,
    width,
    height,
    prompt,
    metadata: {
      ...metadata,
      qaResult,
      retryQaResult,
      retryAttempted,
      finalSelection,
      ...(qaError ? { qaError } : {})
    }
  });
}

export async function generateOpenAIImageWithQa({
  prompt,
  apiKey,
  imageModel,
  qaModel,
  width,
  height,
  cfg,
  source = 'auto',
  metadata = {},
  generateImage = generateWithOpenAI,
  evaluateImage = evaluateGeneratedImageWithOpenAI,
  appendLog = appendPromptLog
}) {
  const model = imageModel || cfg?.openaiImageModel || 'gpt-image-1';
  const initialMetadata = { ...metadata, attempt: 'initial' };
  const initialBuffer = await generateImage({
    prompt,
    apiKey,
    model,
    width,
    height,
    logSource: source,
    metadata: initialMetadata
  });

  if (!shouldRunQa(cfg, metadata)) {
    const result = {
      buffer: initialBuffer,
      prompt,
      qaResult: null,
      retryQaResult: null,
      retryAttempted: false,
      finalSelection: 'initial_no_qa'
    };
    await appendSelectionLog({
      appendLog,
      source,
      model,
      width,
      height,
      prompt,
      metadata,
      ...result
    });
    return result;
  }

  let qaResult = null;
  let retryQaResult = null;
  let retryAttempted = false;
  let finalSelection = 'initial_passed';
  let finalBuffer = initialBuffer;
  let finalPrompt = prompt;
  let qaError = null;

  try {
    qaResult = await evaluateImage({
      imageBuffer: initialBuffer,
      prompt,
      metadata,
      apiKey,
      model: qaModel || cfg?.openaiTextModel || 'gpt-5.4-mini'
    });

    if (!qaResult.pass && resolveEmbeddedHeadlineConfig(cfg).retryOnReject) {
      retryAttempted = true;
      const retryPrompt = buildQaRetryPrompt(prompt, qaResult, metadata.embeddedHeadlineText || {});
      const retryBuffer = await generateImage({
        prompt: retryPrompt,
        apiKey,
        model,
        width,
        height,
        logSource: source,
        metadata: {
          ...metadata,
          attempt: 'retry',
          previousQaResult: qaResult
        }
      });

      retryQaResult = await evaluateImage({
        imageBuffer: retryBuffer,
        prompt: retryPrompt,
        metadata,
        apiKey,
        model: qaModel || cfg?.openaiTextModel || 'gpt-5.4-mini'
      });

      if (retryQaResult.pass) {
        finalBuffer = retryBuffer;
        finalPrompt = retryPrompt;
        finalSelection = 'retry_passed';
      } else {
        finalSelection = 'initial_kept_after_retry_failed';
      }
    } else if (!qaResult.pass) {
      finalSelection = 'initial_qa_failed_no_retry';
    }
  } catch (err) {
    qaError = err?.message || String(err);
    finalSelection = retryAttempted ? 'initial_kept_after_retry_error' : 'initial_kept_qa_error';
  }

  const result = {
    buffer: finalBuffer,
    prompt: finalPrompt,
    qaResult,
    retryQaResult,
    retryAttempted,
    finalSelection,
    qaError
  };

  await appendSelectionLog({
    appendLog,
    source,
    model,
    width,
    height,
    prompt: finalPrompt,
    metadata,
    qaResult,
    retryQaResult,
    retryAttempted,
    finalSelection,
    qaError
  });

  return result;
}
