import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { als } from "./context.js";
import { makeEvent } from "./hooks.js";
import { readSession, sessionCookie } from "./session.js";
import { baseSecurityHeaders } from "./security.js";

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    const finish = (error) => {
      req.off("data", data);
      req.off("end", end);
      req.off("error", finish);
      req.off("aborted", aborted);
      if (error) {
        req.resume();
        reject(error);
      } else resolve(Buffer.concat(chunks));
    };
    const data = (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) finish(Object.assign(new Error("request body too large"), { status: 413 }));
      else chunks.push(chunk);
    };
    const end = () => finish();
    const aborted = () => finish(Object.assign(new Error("request aborted"), { status: 400 }));
    req.on("data", data);
    req.once("end", end);
    req.once("error", finish);
    req.once("aborted", aborted);
    if (Number(req.headers["content-length"]) > limit) finish(Object.assign(new Error("request body too large"), { status: 413 }));
  });
}

export async function handleEndpoint(req, res, { load, params, store, secret, locals, development = false }) {
  store ??= readSession(req.headers.cookie, secret);
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once("close", abort);
  try {
    const mod = await load();
    const allowed = METHODS.filter((method) => typeof mod[method] === "function");
    if (allowed.includes("GET") && !allowed.includes("HEAD")) allowed.push("HEAD");
    if (!allowed.includes("OPTIONS")) allowed.push("OPTIONS");
    const allow = METHODS.filter((method) => allowed.includes(method)).join(", ");
    const method = req.method;
    let response;
    if (method === "OPTIONS" && typeof mod.OPTIONS !== "function") {
      response = new Response(null, { status: 204, headers: { allow } });
      req.resume();
    } else if (!allowed.includes(method)) {
      response = Response.json({ error: "method not allowed" }, { status: 405, headers: { allow } });
      req.resume();
    } else {
      const url = new URL(req.url, process.env.NIRAL_ORIGIN ?? `${req.socket.encrypted ? "https" : "http"}://${req.headers.host}`);
      if (!["GET", "HEAD", "OPTIONS"].includes(method) && req.headers.origin) {
        let sameOrigin = false;
        try { sameOrigin = new URL(req.headers.origin).host === url.host; } catch {}
        if (!sameOrigin) throw Object.assign(new Error("cross-origin request rejected"), { status: 403 });
      }
      const limit = Number(process.env.NIRAL_MAX_BODY ?? 1024 * 1024);
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("NIRAL_MAX_BODY must be a positive integer");
      const body = await readBody(req, limit);
      const headers = new Headers();
      for (let index = 0; index < req.rawHeaders.length; index += 2) headers.append(req.rawHeaders[index], req.rawHeaders[index + 1]);
      const request = new Request(url, {
        method, headers, signal: controller.signal,
        ...(!["GET", "HEAD"].includes(method) && body.length ? { body } : {}),
      });
      const event = makeEvent(req, url.pathname, store);
      const handler = method === "HEAD" && typeof mod.HEAD !== "function" ? mod.GET : mod[method];
      response = await als.run(store, () => handler({
        request, params, url, locals: locals ?? {}, session: event.session,
        user: () => event.session.get("user", null),
      }));
      if (!(response instanceof Response)) throw new TypeError("endpoint handlers must return a Response");
    }
    const headers = { ...baseSecurityHeaders(), "cache-control": "no-store" };
    for (const [name, value] of response.headers) {
      if (!["set-cookie", "connection", "transfer-encoding", "keep-alive", "upgrade", "trailer"].includes(name)) headers[name] = value;
    }
    const cookies = response.headers.getSetCookie();
    if (store.dirty) cookies.push(sessionCookie(store, secret));
    if (cookies.length) headers["set-cookie"] = cookies;
    res.writeHead(response.status, headers);
    if (req.method === "HEAD" || !response.body) {
      await response.body?.cancel();
      res.end();
    } else {
      await pipeline(Readable.fromWeb(response.body), res, { signal: controller.signal });
    }
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    const status = [400, 403, 413].includes(error.status) ? error.status : error instanceof SyntaxError ? 400 : 500;
    if (status === 500) console.error("niral endpoint:", error);
    req.resume();
    res.writeHead(status, { ...baseSecurityHeaders(), "content-type": "application/json", "cache-control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : JSON.stringify({ error: status === 500 && !development ? "internal error" : error.message }));
  } finally {
    res.off("close", abort);
  }
}