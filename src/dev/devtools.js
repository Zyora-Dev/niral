import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { relative, sep } from "node:path";
import { AuthRequiredError } from "../server/rpc.js";

export function clientSourceLocations(source, ast, code) {
  if (!ast.script) return {};
  const originals = new Map();
  const first = source.slice(0, ast.script.start).split("\n").length;
  source.slice(ast.script.start, ast.script.end).split("\n").forEach((line, index) => {
    const text = line.trim();
    if (text.length > 2) originals.set(text, originals.has(text) ? null : first + index);
  });
  const lines = {};
  code.split("\n").forEach((line, index) => {
    const original = originals.get(line.trim());
    if (original) lines[index + 1] = original;
  });
  return lines;
}

export function localDevtoolsRequest(req) {
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) return false;
  if (Object.keys(req.headers).some(name => name === "forwarded" || name.startsWith("x-forwarded-"))) return false;
  try {
    const origin = new URL(`http://${req.headers.host}`);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) return false;
    if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) return false;
    if (Number(origin.port || 80) !== req.socket.localPort) return false;
    if (req.headers.origin && req.headers.origin !== origin.origin) return false;
    const site = req.headers["sec-fetch-site"];
    return !site || site === "same-origin" || site === "none";
  } catch { return false; }
}

export function createDevtools(root) {
  const context = new AsyncLocalStorage();
  const records = [];
  let sequence = 0;
  const source = file => relative(root, file).split(sep).join("/");
  const elapsed = start => Math.round((performance.now() - start) * 100) / 100;

  function run(req, res, task) {
    if (!localDevtoolsRequest(req) || (req.url.startsWith("/@niral/") && req.url.split("?")[0] !== "/@niral/rpc")) return task();
    const record = { id: ++sequence, requestId: randomUUID(), time: new Date().toISOString(), kind: "request", method: req.method, route: "(unmatched)", layouts: [], loads: [], failure: null };
    res.setHeader("x-niral-trace", record.requestId);
    const start = performance.now();
    let finished = false;
    const finish = aborted => {
      if (finished) return;
      finished = true;
      record.status = res.statusCode;
      record.duration = elapsed(start);
      if (aborted) record.failure = "aborted";
      if (record.kind === "request" && record.status < 400 && !record.failure) return;
      records.push(record);
      if (records.length > 100) records.shift();
    };
    res.once("finish", () => finish(false));
    res.once("close", () => finish(!res.writableFinished));
    return context.run(record, task);
  }

  function route(entry, layouts) {
    const record = context.getStore();
    if (!record) return;
    record.kind = "route";
    record.route = entry.pattern;
    record.module = source(entry.file);
    record.layouts = layouts.map(layout => source(layout.abs));
  }

  function failure(kind = "server") {
    const record = context.getStore();
    if (record) record.failure ??= kind;
  }

  async function load(file, task) {
    const record = context.getStore();
    if (!record) return task();
    const start = performance.now();
    const span = { module: source(file), duration: 0, failed: false };
    try { return await task(); }
    catch (error) {
      span.failed = !(error instanceof AuthRequiredError);
      if (span.failed) failure("loader");
      throw error;
    }
    finally {
      span.duration = elapsed(start);
      if (record.loads.length < 32) record.loads.push(span);
    }
  }

  async function rpc(file, name, task) {
    const record = context.getStore();
    if (!record) return task();
    record.kind = "rpc";
    record.route = "/@niral/rpc";
    record.module = source(file);
    const start = performance.now();
    try {
      const result = await task();
      record.fn = ![403, 404].includes(result.status) && /^[A-Za-z_$][\w$]{0,79}$/.test(name) ? name : "(unavailable)";
      if (result.status >= 400) failure("rpc");
      if (result.stream) {
        const stream = result.stream;
        result.stream = (async function* () {
          try { yield* stream; }
          catch (error) { failure("rpc-stream"); throw error; }
        })();
      }
      return result;
    } catch (error) { failure("rpc"); throw error; }
    finally { record.rpcDuration = elapsed(start); }
  }

  return { run, route, load, rpc, failure, snapshot: () => structuredClone(records) };
}