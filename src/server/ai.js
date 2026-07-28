/**
 * Niral server — AI client (zero-dep).
 *
 * Speaks the OpenAI-compatible wire format — the de-facto standard served by
 * OpenAI, Azure, Ollama, vLLM, llama.cpp, Together, Groq … so `ai.*` works
 * against ANY of them, including a self-hosted model. We speak the protocol;
 * the user brings the endpoint + key.
 *
 *   NIRAL_AI_URL    base URL, e.g. https://api.openai.com/v1  or
 *                   http://localhost:11434/v1 (Ollama)  — REQUIRED
 *   NIRAL_AI_KEY    bearer token (omit for local servers)
 *   NIRAL_AI_MODEL  default model name
 *
 * Ambient in every <server> block:
 *   const text   = await ai.chat("explain closures")
 *   const answer = await ai.chat([{role:"user",content:q}], { system: "be brief" })
 *   for await (const chunk of ai.stream(q)) { … }        // token streaming
 *   const [vec]  = await ai.embed(["some text"])          // embeddings
 *   const data   = await ai.chat(q, { json: true })       // parsed JSON output
 */

function cfg() {
  const base = (process.env.NIRAL_AI_URL ?? "").replace(/\/$/, "");
  if (!base) {
    throw new Error("ai: set NIRAL_AI_URL to an OpenAI-compatible endpoint (e.g. https://api.openai.com/v1 or http://localhost:11434/v1)");
  }
  return { base, key: process.env.NIRAL_AI_KEY, model: process.env.NIRAL_AI_MODEL };
}

function headers(key) {
  return { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) };
}

/** string | array → chat messages, with optional system prompt. */
function toMessages(input, system) {
  const msgs = typeof input === "string" ? [{ role: "user", content: input }] : [...input];
  if (system) msgs.unshift({ role: "system", content: system });
  return msgs;
}

async function chat(input, { model, system, temperature, maxTokens, json = false } = {}) {
  const { base, key, model: defModel } = cfg();
  const body = {
    model: model ?? defModel,
    messages: toMessages(input, system),
    ...(temperature != null ? { temperature } : {}),
    ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
    ...(json ? { response_format: { type: "json_object" } } : {}),
  };
  const res = await fetch(`${base}/chat/completions`, { method: "POST", headers: headers(key), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`ai.chat: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  return json ? JSON.parse(text) : text;
}

/** Token stream — async iterable of content chunks (SSE parsing, no deps). */
async function* stream(input, { model, system, temperature, maxTokens } = {}) {
  const { base, key, model: defModel } = cfg();
  const body = {
    model: model ?? defModel,
    messages: toMessages(input, system),
    stream: true,
    ...(temperature != null ? { temperature } : {}),
    ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
  };
  const res = await fetch(`${base}/chat/completions`, { method: "POST", headers: headers(key), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`ai.stream: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        /* keep-alive/comment frames */
      }
    }
  }
}

/** Embeddings — accepts one string or an array, returns array of vectors. */
async function embed(input, { model } = {}) {
  const { base, key, model: defModel } = cfg();
  const texts = Array.isArray(input) ? input : [input];
  const res = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({ model: model ?? process.env.NIRAL_AI_EMBED_MODEL ?? defModel, input: texts }),
  });
  if (!res.ok) throw new Error(`ai.embed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export const ai = { chat, stream, embed };
