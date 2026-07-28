/**
 * Niral runtime — RPC stub transport.
 *
 * The compiler replaces every exported <server> function with a call to
 * this. On the server (SSR) the promise never settles — render is
 * synchronous, so data loads happen on the client after hydration in v0.1.
 *
 * STREAMING: a server fn that is an async generator streams — the stub's
 * promise resolves to an ASYNC ITERABLE of chunks:
 *   const stream = await ask(prompt);
 *   for await (const chunk of stream) { … }
 */

export function rpc(moduleId, fn, args) {
  if (typeof window === "undefined") return new Promise(() => {});
  return fetch("/@niral/rpc", {
    method: "POST",
    headers: { "content-type": "application/json", "x-niral-rpc": "1" },
    body: JSON.stringify({ module: moduleId, fn, args }),
  }).then(async (res) => {
    if (res.headers.get("x-niral-stream") === "1") return ndjsonStream(res, fn);
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`rpc ${fn}: bad response (${res.status})`);
    }
    if (!data.ok) {
      // validation failures carry per-field messages — surface them, not just "validation failed"
      const detail = data.errors ? ": " + Object.entries(data.errors).map(([f, m]) => m ?? f).join("; ") : "";
      const err = new Error(`rpc ${fn}: ${data.error}${detail}`);
      err.errors = data.errors ?? null; // structured access for form UIs
      throw err;
    }
    return data.result;
  });
}

/** NDJSON lines → async iterable of chunk values. */
async function* ndjsonStream(res, fn) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.error) throw new Error(`rpc ${fn}: ${msg.error}`);
      if (msg.done) return;
      yield msg.chunk;
    }
  }
}
