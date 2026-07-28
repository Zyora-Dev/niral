/**
 * Niral server — observability (zero-dep).
 *
 * Production visibility without an APM vendor:
 *   · structured request logs (JSON lines on stdout — one line per response:
 *     method, path, status, duration; slow requests and 4xx/5xx escalate)
 *   · `log.info/warn/error/debug(msg, fields)` — ambient in <server> blocks
 *   · GET /@niral/health — release hash, uptime, pid (load-balancer probe)
 *
 * Env:
 *   NIRAL_LOG=off       silence everything (tests, quiet deploys)
 *   NIRAL_LOG=pretty    human one-liners instead of JSON (dev default)
 *   NIRAL_ACCESS_LOG=off  keep app logs but drop per-request lines
 *   NIRAL_SLOW_MS=1000  threshold that escalates a request to `warn`
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function emit(level, msg, fields, scope) {
  if (process.env.NIRAL_LOG === "off") return;
  const stream = LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout;
  if (process.env.NIRAL_LOG === "pretty") {
    const extra = fields && Object.keys(fields).length ? " " + JSON.stringify(fields) : "";
    stream.write(`niral · ${level.padEnd(5)} ${scope ? scope + " " : ""}${msg}${extra}\n`);
    return;
  }
  stream.write(JSON.stringify({ t: new Date().toISOString(), level, ...(scope ? { scope } : {}), msg, ...fields }) + "\n");
}

/** A leveled structured logger. `scope` tags every line (e.g. a module name). */
export function makeLog(scope = null) {
  return {
    debug: (msg, fields) => emit("debug", String(msg), fields, scope),
    info: (msg, fields) => emit("info", String(msg), fields, scope),
    warn: (msg, fields) => emit("warn", String(msg), fields, scope),
    error: (msg, fields) => emit("error", String(msg), fields, scope),
  };
}

/** The ambient `log` every <server> block gets. */
export const log = makeLog("app");

const serverLog = makeLog(null);

/** Log one request when its response finishes. Call at the TOP of the
 *  request handler — duration covers everything after it. Mints a request id
 *  (req.__niralReqId) so error lines correlate with their access line. */
export function logRequest(req, res) {
  req.__niralReqId ??= Math.random().toString(16).slice(2, 10);
  if (process.env.NIRAL_ACCESS_LOG === "off" || process.env.NIRAL_LOG === "off") return;
  const started = performance.now();
  res.on("finish", () => {
    const ms = +(performance.now() - started).toFixed(1);
    const slow = ms >= (Number(process.env.NIRAL_SLOW_MS) || 1000);
    const status = res.statusCode;
    const level = status >= 500 ? "error" : status >= 400 || slow ? "warn" : "info";
    const fields = { req: req.__niralReqId, method: req.method, path: req.url, status, ms };
    if (slow) fields.slow = true;
    serverLog[level]("request", fields);
  });
}

/** Log an unhandled request error with route attribution. */
export function logError(err, req) {
  serverLog.error("unhandled error", {
    req: req?.__niralReqId,
    method: req?.method,
    path: req?.url,
    error: String(err?.message ?? err),
    stack: typeof err?.stack === "string" ? err.stack.split("\n").slice(0, 6).join("\n") : undefined,
  });
}

const bootedAt = Date.now();

/** GET /@niral/health payload — cheap, no secrets. */
export function healthPayload({ release = null } = {}) {
  return {
    ok: true,
    release,
    uptime_s: Math.round((Date.now() - bootedAt) / 1000),
    pid: process.pid,
    now: new Date().toISOString(),
  };
}
