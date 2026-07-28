/**
 * Niral server — multipart/form-data parsing (file uploads).
 *
 * Hand-rolled boundary parser on plain Buffers. Hard caps everywhere: an
 * upload can never eat your memory (size checked as the body arrives, not
 * after). Files land in your action as
 *
 *   export async function upload(form) {
 *     form.avatar             // { filename, type, size, data: Buffer }
 *     form.title              // plain fields stay strings
 *   }
 *
 * Caps: NIRAL_MAX_UPLOAD (total, default 10MB) · maxFiles 20 per request.
 * Filenames are sanitized (basename only, no traversal).
 */

export const DEFAULT_MAX_UPLOAD = 10 * 1024 * 1024;
const MAX_FILES = 20;

/** The boundary from a content-type header, or null if not multipart. */
export function multipartBoundary(contentType) {
  const m = /multipart\/form-data;.*boundary="?([^";]+)"?/i.exec(contentType ?? "");
  return m ? m[1] : null;
}

const sanitizeFilename = (name) =>
  String(name ?? "upload")
    .split(/[\\/]/)
    .pop()
    .replace(/[^\w.\-() ]+/g, "_")
    .slice(0, 200) || "upload";

/**
 * Parse a multipart body. Repeated field names become arrays.
 * Throws on malformed input or too many files — callers 400 it.
 */
export function parseMultipart(body, boundary, { maxFiles = MAX_FILES } = {}) {
  const delim = Buffer.from(`--${boundary}`);
  const out = {};
  let files = 0;

  let at = body.indexOf(delim);
  if (at === -1) throw new Error("multipart: boundary not found");
  at += delim.length;

  for (;;) {
    if (body.slice(at, at + 2).toString() === "--") break; // closing delimiter
    at += 2; // CRLF after the delimiter

    const headerEnd = body.indexOf("\r\n\r\n", at);
    if (headerEnd === -1) throw new Error("multipart: truncated part headers");
    const headers = body.slice(at, headerEnd).toString("utf8");
    const next = body.indexOf(delim, headerEnd + 4);
    if (next === -1) throw new Error("multipart: truncated part body");
    const content = body.slice(headerEnd + 4, next - 2); // strip trailing CRLF

    const disp = /content-disposition:\s*form-data;\s*(.*)/i.exec(headers)?.[1] ?? "";
    const name = /name="([^"]*)"/.exec(disp)?.[1];
    const filename = /filename="([^"]*)"/.exec(disp)?.[1];
    const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim();

    if (name) {
      let value;
      if (filename !== undefined) {
        if (++files > maxFiles) throw new Error(`multipart: more than ${maxFiles} files`);
        value = {
          filename: sanitizeFilename(filename),
          type: type ?? "application/octet-stream",
          size: content.length,
          data: content,
        };
      } else {
        value = content.toString("utf8");
      }
      if (name in out) {
        if (Array.isArray(out[name])) out[name].push(value);
        else out[name] = [out[name], value];
      } else out[name] = value;
    }
    at = next + delim.length;
  }
  return out;
}

/** For worker-language actions: Buffers can't cross NBP — base64 them. */
export function encodeFilesForWorker(form) {
  const out = {};
  for (const [k, v] of Object.entries(form)) {
    const conv = (x) =>
      x && typeof x === "object" && Buffer.isBuffer(x.data)
        ? { filename: x.filename, type: x.type, size: x.size, data_base64: x.data.toString("base64") }
        : x;
    out[k] = Array.isArray(v) ? v.map(conv) : conv(v);
  }
  return out;
}
