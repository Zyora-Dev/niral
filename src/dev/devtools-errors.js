const kinds = new Set(["error", "rejection", "runtime", "rpc", "rpc-stream"]);
const names = new Set(["Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError", "URIError", "EvalError", "AggregateError"]);
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createErrorTracker() {
  const sources = new Map();
  const groups = new Map();
  let seen = new WeakMap();
  let sequence = 0;
  let actionSequence = 0;
  let action = null;
  let activeEvent = null;

  function location(stack) {
    if (typeof stack !== "string") return null;
    let fallback = null;
    for (const frame of stack.split("\n").slice(1, 33)) {
      for (const [module, source] of sources) {
        const marker = `niral:${module}:`;
        const offset = frame.indexOf(marker);
        if (offset < 0) continue;
        const match = /^(\d+):(\d+)(?:\)|\s|$)/.exec(frame.slice(offset + marker.length));
        if (!match) continue;
        const line = source.lines[Number(match[1])] ?? null;
        const result = { module, line, editor: line && source.editor ? `${source.editor}:${line}` : null };
        if (line) return result;
        fallback ??= result;
      }
    }
    return fallback;
  }

  function capture(error, context = {}) {
    const kind = kinds.has(context.kind) ? context.kind : "error";
    const object = error !== null && (typeof error === "object" || typeof error === "function");
    if (object && seen.has(error) && seen.get(error) !== kind && ["error", "rejection", "runtime"].includes(kind)) return;
    if (object) seen.set(error, kind);
    let name = "Error";
    let stack;
    try {
      const candidate = error?.name;
      if (names.has(candidate)) name = candidate;
      stack = error?.stack;
    } catch {}
    const source = context.source ?? location(stack);
    const key = JSON.stringify([kind, name, source?.module, source?.line, context.action?.type]);
    const time = new Date().toISOString();
    let group = groups.get(key);
    if (!group) {
      group = { id: ++sequence, kind, name, source, count: 0, first: time, last: time, occurrences: [] };
      groups.set(key, group);
    }
    group.count++;
    group.last = time;
    group.occurrences.push({ time, requestId: context.requestId ?? null, action: context.action ?? null });
    if (group.occurrences.length > 20) group.occurrences.shift();
    groups.delete(key);
    groups.set(key, group);
    if (groups.size > 100) groups.delete(groups.keys().next().value);
  }

  return {
    register(module, source) {
      if (typeof module !== "string" || !module.startsWith("/") || !/\.(niral|jsx|tsx)$/.test(module)) return;
      sources.delete(module);
      sources.set(module, source);
      if (sources.size > 512) sources.delete(sources.keys().next().value);
    },
    action(type, event = null) {
      if (!["click", "submit", "change", "keydown"].includes(type)) return;
      const current = { id: ++actionSequence, type };
      action = current;
      activeEvent = event;
      const clear = () => { if (action === current) { action = null; activeEvent = null; } };
      if (event) setTimeout(clear, 0);
      else queueMicrotask(clear);
    },
    capture,
    rpc() {
      const context = { kind: "rpc", action: activeEvent && !activeEvent.eventPhase ? null : action, source: location(new Error().stack), requestId: null };
      return {
        response(response) {
          const value = response.headers.get("x-niral-trace");
          if (requestIdPattern.test(value ?? "")) context.requestId = value;
        },
        fail(error) { capture(error, context); },
        async *stream(iterable) {
          try { yield* iterable; }
          catch (error) { capture(error, { ...context, kind: "rpc-stream" }); throw error; }
        },
      };
    },
    snapshot: () => structuredClone([...groups.values()].reverse()),
    clear() { groups.clear(); seen = new WeakMap(); },
  };
}