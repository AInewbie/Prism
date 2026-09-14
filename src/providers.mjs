import { providerArtifacts, MAX_SYNTHESIS_IMAGES, MAX_SYNTHESIS_IMAGE_BYTES,
  MAX_SYNTHESIS_IMAGE_TOTAL_BYTES, MAX_SYNTHESIS_PDFS, MAX_SYNTHESIS_PDF_BYTES,
  MAX_SYNTHESIS_PDF_TOTAL_BYTES } from './artifacts.mjs';
import { AppError, provider, modelId } from "./core.mjs";
const bases = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  grok: "https://api.x.ai/v1",
  claude: "https://api.anthropic.com/v1",
};
function headers(id, key) {
  return {
    "Content-Type": "application/json",
    ...(id === "gemini"
      ? { "x-goog-api-key": key }
      : id === "claude"
        ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
        : { Authorization: "Bearer " + key }),
  };
}
async function jsonRequest(url, init, fetcher, limit = 2_000_000) {
  let response;
  try {
    response = await fetcher(url, { ...init, redirect: "error" });
  } catch {
    throw new AppError(
      "Provider connection failed, timed out or was stopped. No automatic retry.",
      502,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    const hint =
      {
        400: "Check model support, input length and output limit.",
        401: "API key rejected.",
        403: "Check model access and key permissions.",
        404: "Model unavailable. Choose an available text model.",
        429: "Rate limit or API quota reached. Check provider billing and limits.",
      }[response.status] || "Try again later.";
    throw new AppError("Provider HTTP " + response.status + ". " + hint, 502);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new AppError("Provider returned an empty response.", 502);
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw Error();
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AppError(
      "Provider returned invalid, oversized or interrupted data.",
      502,
    );
  }
}
export function requestSpec(id, key, model, system, prompt, maxTokens, options = {}) {
  provider(id);
  modelId(model);
  const outputMode = options.outputMode || "text";
  if (!['text', 'visual'].includes(outputMode)) throw new AppError('Choose a supported output type.');
  if (outputMode === 'visual' && !['openai', 'gemini'].includes(id))
    throw new AppError('This provider does not support image output in Prism yet.');
  const images = options.images || [];
  if (!Array.isArray(images)) throw new AppError('Invalid visual synthesis inputs.');
  if (images.length > MAX_SYNTHESIS_IMAGES)
    throw new AppError('Too many visual synthesis inputs.');
  let imageBytes = 0;
  for (const image of images) {
    if (!image || !['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType) ||
        typeof image.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data) || image.data.length % 4 !== 0)
      throw new AppError('Invalid visual synthesis input.');
    const bytes = Buffer.from(image.data, 'base64');
    if (bytes.toString('base64') !== image.data || bytes.length > MAX_SYNTHESIS_IMAGE_BYTES)
      throw new AppError('Invalid or oversized visual synthesis input.');
    imageBytes += bytes.length;
  }
  if (imageBytes > MAX_SYNTHESIS_IMAGE_TOTAL_BYTES)
    throw new AppError('Visual synthesis inputs exceed the total size limit.');
  if (images.length && !['openai', 'gemini', 'claude'].includes(id))
    throw new AppError('Visual synthesis is available with ChatGPT, Gemini or Claude.');
  const pdfs = options.pdfs || [];
  if (!Array.isArray(pdfs)) throw new AppError('Invalid PDF synthesis inputs.');
  if (pdfs.length > MAX_SYNTHESIS_PDFS) throw new AppError('Too many PDF synthesis inputs.');
  let pdfBytes = 0;
  for (const pdf of pdfs) {
    if (!pdf || pdf.mimeType !== 'application/pdf' || typeof pdf.name !== 'string' ||
        typeof pdf.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(pdf.data) || pdf.data.length % 4 !== 0)
      throw new AppError('Invalid PDF synthesis input.');
    const bytes = Buffer.from(pdf.data, 'base64');
    if (bytes.toString('base64') !== pdf.data || bytes.length > MAX_SYNTHESIS_PDF_BYTES ||
        !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-')))
      throw new AppError('Invalid or oversized PDF synthesis input.');
    pdfBytes += bytes.length;
  }
  if (pdfBytes > MAX_SYNTHESIS_PDF_TOTAL_BYTES)
    throw new AppError('PDF synthesis inputs exceed the total size limit.');
  if (pdfs.length && !['openai', 'gemini', 'claude'].includes(id))
    throw new AppError('PDF synthesis is available with ChatGPT, Gemini or Claude.');
  let path, body;
  if (id === "openai" || id === "grok") {
    path = "/responses";
    body = {
      model,
      input: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: images.length || pdfs.length ? [
          ...pdfs.map((pdf) => ({ type: 'input_file', filename: pdf.name,
            file_data: 'data:application/pdf;base64,' + pdf.data, detail: 'auto' })),
          { type: 'input_text', text: prompt },
          ...images.map((image) => ({ type: 'input_image',
            image_url: 'data:' + image.mimeType + ';base64,' + image.data,
            detail: 'auto' })),
        ] : prompt },
      ],
      max_output_tokens: maxTokens,
      store: false,
      ...(outputMode === 'visual' ? {
        tools: [{ type: 'image_generation', model: modelId(options.imageModel) }],
        tool_choice: { type: 'image_generation' },
      } : {}),
    };
  } else if (id === "gemini") {
    if (outputMode === 'visual' || (images.length && !pdfs.length)) {
      path = '/interactions';
      body = {
        model: outputMode === 'visual' ? modelId(options.imageModel) : model,
        input: images.length ? [
          { type: 'text', text: system ? 'System instructions:\n' + system + '\n\nUser payload:\n' + prompt : prompt },
          ...images.map((image) => ({ type: 'image', data: image.data, mime_type: image.mimeType })),
        ] : (system ? 'Shared instructions:\n' + system + '\n\nPrompt:\n' + prompt : prompt),
        ...(outputMode === 'visual' ? { response_format: [{ type: 'text' }, { type: 'image' }] } : {}),
      };
    } else {
      path = "/models/" + encodeURIComponent(model) + ":generateContent";
      body = {
        contents: [{ role: "user", parts: [
          ...pdfs.map((pdf) => ({ inlineData: { mimeType: 'application/pdf', data: pdf.data } })),
          ...images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data } })),
          { text: prompt },
        ] }],
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: { maxOutputTokens: maxTokens },
      };
    }
  } else {
    path = "/messages";
    body = {
      model,
      messages: [{ role: "user", content: images.length || pdfs.length ? [
        ...pdfs.map((pdf) => ({ type: 'document', source: { type: 'base64',
          media_type: 'application/pdf', data: pdf.data }, title: pdf.name })),
        ...images.map((image) => ({ type: 'image', source: { type: 'base64',
          media_type: image.mimeType, data: image.data } })),
        { type: 'text', text: prompt },
      ] : prompt }],
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
    };
  }
  return {
    url: bases[id] + path,
    init: {
      method: "POST",
      headers: headers(id, key),
      body: JSON.stringify(body),
    },
  };
}
const count = (n) =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
export function parseAnswer(id, data) {
  let text = "",
    warning = "",
    inputTokens = null,
    outputTokens = null;
  if (id === "openai" || id === "grok") {
    text = (Array.isArray(data.output) ? data.output : [])
      .filter((x) => x.type === "message")
      .flatMap((x) => (Array.isArray(x.content) ? x.content : []))
      .map((x) =>
        x.type === "output_text"
          ? x.text
          : x.type === "refusal"
            ? x.refusal
            : "",
      )
      .join("\n");
    inputTokens = count(data.usage?.input_tokens);
    outputTokens = count(data.usage?.output_tokens);
    if (data.status === "incomplete")
      warning = "Output may be incomplete. Review before scoring or combining.";
  } else if (id === "gemini") {
    const c = data.candidates?.[0], interaction = (data.steps || [])
      .filter((step) => step.type === 'model_output')
      .flatMap((step) => step.content || []);
    text = (interaction.length ? interaction : c?.content?.parts || [])
      .filter((x) => !x.thought && typeof x.text === "string")
      .map((x) => x.text)
      .join("\n");
    inputTokens = count(data.usageMetadata?.promptTokenCount);
    outputTokens = count(data.usageMetadata?.candidatesTokenCount);
    if (c?.finishReason && c.finishReason !== "STOP")
      warning =
        "Provider stopped early (" +
        String(c.finishReason).slice(0, 50) +
        "). Review this answer.";
  } else {
    text = (Array.isArray(data.content) ? data.content : [])
      .filter((x) => x.type === "text")
      .map((x) => x.text)
      .join("\n");
    inputTokens = count(data.usage?.input_tokens);
    outputTokens = count(data.usage?.output_tokens);
    if (data.stop_reason === "max_tokens")
      warning = "Output limit reached. This answer may be incomplete.";
  }
  const rich = providerArtifacts(id, data, text);
  if (typeof text !== "string" || (!text.trim() && !rich.artifacts.length))
    throw new AppError(
      "No supported visible output returned. The prompt may be blocked, or reasoning may have used the output limit.",
      502,
    );
  if (text.length > 120000)
    throw new AppError("Answer too large. Ask for a shorter response.", 502);
  return { text, artifacts: rich.artifacts, warning: [warning, rich.warning].filter(Boolean).join(" "), inputTokens, outputTokens };
}
export async function ask(
  id,
  key,
  model,
  system,
  prompt,
  maxTokens,
  signal,
  fetcher = fetch,
  options = {},
) {
  const { url, init } = requestSpec(id, key, model, system, prompt, maxTokens, options);
  return parseAnswer(id, await jsonRequest(url, { ...init, signal }, fetcher, 18_000_000));
}
export async function listModels(id, key, signal, fetcher = fetch) {
  provider(id);
  const models = new Set();
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const url = new URL(bases[id] + "/models");
    if (id === "gemini") {
      url.searchParams.set("pageSize", "1000");
      if (cursor) url.searchParams.set("pageToken", cursor);
    }
    if (id === "claude") {
      url.searchParams.set("limit", "1000");
      if (cursor) url.searchParams.set("after_id", cursor);
    }
    const data = await jsonRequest(
      url.href,
      { headers: headers(id, key), signal },
      fetcher,
    );
    const entries = id === "gemini" ? data.models : data.data;
    if (!Array.isArray(entries))
      throw new AppError(
        "Model list unavailable. Enter a model ID manually.",
        502,
      );
    for (const entry of entries) {
      if (
        id === "gemini" &&
        !entry.supportedGenerationMethods?.includes("generateContent")
      )
        continue;
      const name =
        id === "gemini" ? entry.name?.replace(/^models\//, "") : entry.id;
      if (
        typeof name === "string" &&
        /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(name)
      )
        models.add(name);
    }
    const next =
      id === "gemini"
        ? data.nextPageToken
        : id === "claude" && data.has_more
          ? data.last_id
          : "";
    if (!next) return { models: [...models].sort(), partial: false };
    if (next === cursor)
      throw new AppError("Model pagination stopped advancing.", 502);
    cursor = next;
  }
  return { models: [...models].sort(), partial: true };
}
