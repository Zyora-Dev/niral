function bounded(operation, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation();
    }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function runAgent({
  provider, prompt, system = "", tools = [], authorize = () => false,
  maxTurns = 8, maxToolCalls = 32, maxToolResultBytes = 64 * 1024,
  timeoutMs = 300000, signal,
}) {
  if (typeof provider?.complete !== "function") throw new Error("DI: a provider is required");
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("DI: a prompt is required");
  if (typeof authorize !== "function") throw new Error("DI: authorize must be a function");
  for (const [name, value] of Object.entries({ maxTurns, maxToolCalls, maxToolResultBytes, timeoutMs })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`DI: ${name} must be a positive integer`);
  }
  if (timeoutMs > 2147483647) throw new Error("DI: timeoutMs is too large");
  const registry = new Map();
  for (const tool of tools) {
    if (typeof tool.name !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name) || registry.has(tool.name)
      || typeof tool.description !== "string" || tool.parameters?.type !== "object"
      || typeof tool.validate !== "function" || typeof tool.execute !== "function") {
      throw new Error("DI: each tool needs a unique name, schema, validator and executor");
    }
    registry.set(tool.name, { ...tool, parameters: structuredClone(tool.parameters) });
  }
  const definitions = [...registry.values()].map(({ name, description, parameters }) => ({ name, description, parameters }));
  const controller = new AbortController();
  const cancel = () => controller.abort(new DOMException("DI: run cancelled", "AbortError"));
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("DI: run timed out", "TimeoutError")), timeoutMs);
  const runSignal = controller.signal;
  const messages = [{ role: "user", content: prompt }];
  const usage = [];
  const seenCalls = new Set();
  let toolCalls = 0;
  try {
    for (let turn = 1; turn <= maxTurns; turn++) {
      const response = await bounded(() => provider.complete({ system, messages: structuredClone(messages), tools: structuredClone(definitions), signal: runSignal }), runSignal);
      if (response?.role !== "assistant" || typeof response.content !== "string" || !Array.isArray(response.toolCalls)) throw new Error("DI: invalid agent response");
      messages.push(response);
      usage.push(response.usage ?? null);
      if (response.refused && response.toolCalls.length) throw new Error("DI: refusal cannot contain executable tools");
      if (!response.toolCalls.length) return { text: response.content, refused: response.refused === true, turns: turn, toolCalls, usage, messages };
      if (turn === maxTurns) throw new Error("DI: turn limit reached before tool execution");
      if (toolCalls + response.toolCalls.length > maxToolCalls) throw new Error("DI: tool call limit reached");

      const pending = [];
      for (const call of response.toolCalls) {
        if (typeof call?.id !== "string" || !call.id || seenCalls.has(call.id)) throw new Error("DI: invalid or repeated tool call ID");
        const tool = registry.get(call.name);
        if (!tool) throw new Error("DI: unknown tool requested");
        if (!call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)) throw new Error("DI: invalid tool arguments");
        let valid;
        try { valid = await bounded(() => tool.validate(structuredClone(call.arguments), { signal: runSignal }), runSignal); }
        catch { runSignal.throwIfAborted(); throw new Error("DI: tool argument validation failed"); }
        if (valid !== true) throw new Error("DI: invalid tool arguments");
        seenCalls.add(call.id);
        pending.push({ call: structuredClone(call), tool });
      }

      for (const { call, tool } of pending) {
        let approved;
        try { approved = await bounded(() => authorize(structuredClone(call), { signal: runSignal }), runSignal); }
        catch { runSignal.throwIfAborted(); throw new Error("DI: tool authorization failed"); }
        runSignal.throwIfAborted();
        let content;
        let isError = false;
        if (approved !== true) {
          content = "Tool execution denied by the host.";
          isError = true;
        } else {
          try {
            const output = await bounded(() => tool.execute(structuredClone(call.arguments), { signal: runSignal }), runSignal);
            content = typeof output === "string" ? output : JSON.stringify(output ?? null);
            if (typeof content !== "string") throw new Error("Invalid tool output");
          } catch {
            runSignal.throwIfAborted();
            content = "Tool execution failed; do not assume changes were rolled back.";
            isError = true;
          }
        }
        if (Buffer.byteLength(content) > maxToolResultBytes) throw new Error("DI: tool result exceeded the byte limit");
        toolCalls++;
        messages.push({ role: "tool", callId: call.id, content, isError });
      }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}