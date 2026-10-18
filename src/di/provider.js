const PROTOCOLS = new Set(["chat-completions", "responses", "anthropic"]);
const AUTH = new Set(["bearer", "api-key", "x-api-key", "none"]);
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

function invalidResponse() {
  return new Error("DI: malformed or unsupported provider response");
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`DI: ${name} must be a positive integer`);
}

function toolCall(id, name, args) {
  if (typeof id !== "string" || !id || id.length > 256 || typeof name !== "string" || !TOOL_NAME.test(name)) throw invalidResponse();
  let input = args;
  if (typeof args === "string") {
    try { input = JSON.parse(args); } catch { throw invalidResponse(); }
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalidResponse();
  return { id, name, arguments: input };
}

function tokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function decode(protocol, data) {
  let content = "";
  let toolCalls = [];
  let native;
  let refused = false;
  if (protocol === "chat-completions") {
    const choice = data?.choices?.[0];
    const message = choice?.message;
    if (!message || message.role !== "assistant" || !["stop", "tool_calls"].includes(choice.finish_reason)) throw invalidResponse();
    if (message.content != null && typeof message.content !== "string") throw invalidResponse();
    if (message.function_call) throw invalidResponse();
    content = message.content ?? "";
    refused = Boolean(message.refusal);
    if (refused) content = typeof message.refusal === "string" ? message.refusal : "Provider refused this request.";
    if (message.tool_calls != null && !Array.isArray(message.tool_calls)) throw invalidResponse();
    toolCalls = (message.tool_calls ?? []).map((call) => {
      if (call?.type !== "function" || typeof call.function?.arguments !== "string") throw invalidResponse();
      return toolCall(call.id, call.function?.name, call.function?.arguments);
    });
    if ((choice.finish_reason === "tool_calls") !== (toolCalls.length > 0)) throw invalidResponse();
    native = message;
  } else if (protocol === "responses") {
    if (data?.status !== "completed" || !Array.isArray(data.output)) throw invalidResponse();
    native = data.output;
    for (const item of native) {
      if (item?.type === "function_call") {
        if (typeof item.arguments !== "string" || (item.status != null && item.status !== "completed")) throw invalidResponse();
        toolCalls.push(toolCall(item.call_id, item.name, item.arguments));
      } else if (item?.type === "message") {
        if (item.role !== "assistant" || !Array.isArray(item.content) || (item.status != null && item.status !== "completed")) throw invalidResponse();
        for (const block of item.content) {
          if (block?.type === "output_text" && typeof block.text === "string") content += block.text;
          else if (block?.type === "refusal" && typeof block.refusal === "string") { refused = true; content += block.refusal; }
          else throw invalidResponse();
        }
      } else if (item?.type !== "reasoning") throw invalidResponse();
    }
  } else {
    if (data?.role !== "assistant" || !Array.isArray(data.content) || !["end_turn", "tool_use", "stop_sequence", "refusal"].includes(data.stop_reason)) throw invalidResponse();
    native = data.content;
    refused = data.stop_reason === "refusal";
    for (const block of native) {
      if (block?.type === "text" && typeof block.text === "string") content += block.text;
      else if (block?.type === "tool_use") {
        if (typeof block.input !== "object") throw invalidResponse();
        toolCalls.push(toolCall(block.id, block.name, block.input));
      }
      else if (!["thinking", "redacted_thinking"].includes(block?.type)) throw invalidResponse();
    }
    if ((data.stop_reason === "tool_use") !== (toolCalls.length > 0)) throw invalidResponse();
  }
  if (new Set(toolCalls.map((call) => call.id)).size !== toolCalls.length) throw invalidResponse();
  if (!toolCalls.length && !content && !refused) throw invalidResponse();
  if (refused && toolCalls.length) throw invalidResponse();
  const usage = data.usage ?? {};
  return {
    role: "assistant", content, toolCalls, refused,
    native: { protocol, value: native },
    usage: {
      inputTokens: tokenCount(protocol === "chat-completions" ? usage.prompt_tokens : usage.input_tokens),
      outputTokens: tokenCount(protocol === "chat-completions" ? usage.completion_tokens : usage.output_tokens),
      cacheReadTokens: tokenCount(protocol === "anthropic" ? usage.cache_read_input_tokens : (usage.input_tokens_details ?? usage.prompt_tokens_details)?.cached_tokens),
      cacheWriteTokens: tokenCount(usage.cache_creation_input_tokens),
    },
  };
}

function encodeMessages(protocol, messages) {
  const result = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      if (message.native?.protocol !== protocol) throw new Error("DI: conversation belongs to a different provider protocol");
      if (protocol === "responses") result.push(...message.native.value);
      else if (protocol === "anthropic") result.push({ role: "assistant", content: message.native.value });
      else result.push(message.native.value);
    } else if (message.role === "tool") {
      if (protocol === "responses") result.push({ type: "function_call_output", call_id: message.callId, output: message.content });
      else if (protocol === "chat-completions") result.push({ role: "tool", tool_call_id: message.callId, content: message.content });
      else {
        const block = { type: "tool_result", tool_use_id: message.callId, content: message.content, is_error: message.isError === true };
        const last = result.at(-1);
        if (last?.role === "user" && Array.isArray(last.content)) last.content.push(block);
        else result.push({ role: "user", content: [block] });
      }
    } else if (message.role === "user" && typeof message.content === "string") {
      result.push({ role: "user", content: message.content });
    } else throw new Error("DI: unsupported conversation message");
  }
  return result;
}

async function readJSON(response, maxBytes) {
  if (!response.body) throw invalidResponse();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("DI: provider response exceeded the byte limit");
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw invalidResponse(); }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function createProvider({
  protocol, baseURL, model, apiKey, getCredential,
  auth = protocol === "anthropic" ? "x-api-key" : "bearer",
  apiVersion, maxOutputTokens = 4096, timeoutMs = 120000,
  maxRequestBytes = 2 * 1024 * 1024, maxResponseBytes = 4 * 1024 * 1024,
}, { fetchImpl = globalThis.fetch } = {}) {
  if (!PROTOCOLS.has(protocol)) throw new Error("DI: unsupported API protocol");
  if (!AUTH.has(auth)) throw new Error("DI: unsupported authentication mode");
  if (typeof model !== "string" || !model.trim()) throw new Error("DI: an explicit model is required");
  if (getCredential != null && typeof getCredential !== "function") throw new Error("DI: getCredential must be a function");
  for (const [name, value] of Object.entries({ maxOutputTokens, timeoutMs, maxRequestBytes, maxResponseBytes })) positiveInteger(value, name);
  if (timeoutMs > 2147483647) throw new Error("DI: timeoutMs is too large");
  let url;
  try { url = new URL(baseURL); } catch { throw new Error("DI: a valid API base URL is required"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) throw new Error("DI: HTTPS is required except on loopback endpoints");
  if (url.username || url.password || url.search || url.hash) throw new Error("DI: base URL must not contain credentials, query parameters or fragments");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${protocol === "chat-completions" ? "chat/completions" : protocol === "responses" ? "responses" : "messages"}`;
  if (apiVersion != null) {
    if (typeof apiVersion !== "string" || !apiVersion.trim()) throw new Error("DI: invalid API version");
    if (protocol !== "anthropic") url.searchParams.set("api-version", apiVersion);
  }

  return Object.freeze({
    protocol,
    async complete({ system = "", messages, tools = [], signal }) {
      signal?.throwIfAborted();
      const history = encodeMessages(protocol, messages);
      const definitions = tools.map(({ name, description, parameters }) => {
        if (typeof name !== "string" || !TOOL_NAME.test(name) || typeof description !== "string" || parameters?.type !== "object") throw new Error("DI: invalid tool definition");
        if (protocol === "anthropic") return { name, description, input_schema: parameters };
        const definition = { name, description, parameters, strict: false };
        return protocol === "responses" ? { type: "function", ...definition } : { type: "function", function: definition };
      });
      const body = { model, stream: false, ...(definitions.length ? { tools: definitions } : {}) };
      if (protocol === "responses") Object.assign(body, { instructions: system, input: history, store: false, include: ["reasoning.encrypted_content"], max_output_tokens: maxOutputTokens });
      else if (protocol === "anthropic") Object.assign(body, { system, messages: history, max_tokens: maxOutputTokens });
      else Object.assign(body, { messages: [...(system ? [{ role: "system", content: system }] : []), ...history], max_completion_tokens: maxOutputTokens });
      const serialized = JSON.stringify(body);
      if (Buffer.byteLength(serialized) > maxRequestBytes) throw new Error("DI: request exceeded the byte limit");
      const headers = { "content-type": "application/json" };
      if (protocol === "anthropic") headers["anthropic-version"] = apiVersion ?? "2023-06-01";
      if (auth !== "none") {
        let credential;
        try { credential = getCredential ? await getCredential({ signal }) : apiKey; } catch { throw new Error("DI: credential acquisition failed"); }
        signal?.throwIfAborted();
        if (typeof credential !== "string" || !credential.trim() || /[\r\n]/.test(credential)) throw new Error("DI: a valid credential is required");
        headers[auth === "bearer" ? "authorization" : auth] = auth === "bearer" ? `Bearer ${credential}` : credential;
      }
      const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]);
      let response;
      try {
        response = await fetchImpl(url.href, { method: "POST", headers, body: serialized, redirect: "error", signal: requestSignal });
      } catch {
        signal?.throwIfAborted();
        if (requestSignal.aborted) throw new Error("DI: provider request timed out");
        throw new Error("DI: provider connection failed (redirects are blocked)");
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`DI: provider HTTP ${response.status}; check endpoint, model, authentication and quota`);
      }
      let data;
      try { data = await readJSON(response, maxResponseBytes); } catch (error) {
        signal?.throwIfAborted();
        if (requestSignal.aborted) throw new Error("DI: provider request timed out");
        if (error.message === "DI: provider response exceeded the byte limit") throw error;
        throw invalidResponse();
      }
      signal?.throwIfAborted();
      return decode(protocol, data);
    },
  });
}