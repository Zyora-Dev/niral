/**
 * Niral remote snapshots — encrypted off-box recovery, zero dependencies.
 *
 * Local snapshots remain the source of truth. This module packages one local
 * snapshot directory, compresses it, encrypts it with AES-256-GCM, and sends
 * only ciphertext to any S3-compatible object store using native SigV4.
 *
 * Required env:
 *   NIRAL_SNAPSHOT_REMOTE_URL=https://s3.example.com
 *   NIRAL_SNAPSHOT_REMOTE_BUCKET=my-backups
 *   NIRAL_SNAPSHOT_REMOTE_ACCESS_KEY=...
 *   NIRAL_SNAPSHOT_REMOTE_SECRET_KEY=...
 *   NIRAL_SNAPSHOT_REMOTE_KEY=a-long-separate-encryption-passphrase
 *
 * Optional:
 *   NIRAL_SNAPSHOT_REMOTE_REGION=us-east-1
 *   NIRAL_SNAPSHOT_REMOTE_PREFIX=niral/<app-name>
 *   NIRAL_SNAPSHOT_REMOTE_KEEP=30
 */

import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes,
  scryptSync,
} from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { listSnapshots, restore, snapshot } from "./recover.js";

const MAGIC = Buffer.from("NIRALRS1", "ascii");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CONTENT_TYPE = "application/vnd.niral.snapshot";

const sha256 = (value, encoding = "hex") => createHash("sha256").update(value).digest(encoding);
const hmac = (key, value, encoding = undefined) => createHmac("sha256", key).update(value).digest(encoding);
const encodePath = (value) => value.split("/").map(encodeURIComponent).join("/");

function required(value, name) {
  if (!value) throw new Error(`remote snapshot: ${name} is required`);
  return value;
}

/** Read and validate remote snapshot configuration. */
export function remoteSnapshotConfig(env = process.env) {
  const endpoint = new URL(required(env.NIRAL_SNAPSHOT_REMOTE_URL, "NIRAL_SNAPSHOT_REMOTE_URL"));
  if (!/^https?:$/.test(endpoint.protocol)) throw new Error("remote snapshot: endpoint must be http(s)");
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, "");
  return {
    endpoint,
    bucket: required(env.NIRAL_SNAPSHOT_REMOTE_BUCKET, "NIRAL_SNAPSHOT_REMOTE_BUCKET"),
    accessKey: required(env.NIRAL_SNAPSHOT_REMOTE_ACCESS_KEY, "NIRAL_SNAPSHOT_REMOTE_ACCESS_KEY"),
    secretKey: required(env.NIRAL_SNAPSHOT_REMOTE_SECRET_KEY, "NIRAL_SNAPSHOT_REMOTE_SECRET_KEY"),
    encryptionKey: required(env.NIRAL_SNAPSHOT_REMOTE_KEY, "NIRAL_SNAPSHOT_REMOTE_KEY"),
    region: env.NIRAL_SNAPSHOT_REMOTE_REGION || "us-east-1",
    prefix: (env.NIRAL_SNAPSHOT_REMOTE_PREFIX || "niral-snapshots").replace(/^\/+|\/+$/g, ""),
    keep: Math.max(1, Number(env.NIRAL_SNAPSHOT_REMOTE_KEEP) || 30),
  };
}

/** Pack + encrypt one local snapshot directory. No plaintext leaves this call. */
export function encryptSnapshot(snapshotDir, passphrase) {
  const dir = resolve(snapshotDir);
  const meta = JSON.parse(readFileSync(join(dir, "snapshot.json"), "utf8"));
  const files = {};
  for (const name of meta.files || []) {
    const file = join(dir, basename(name));
    if (!existsSync(file) || !statSync(file).isFile()) continue;
    files[basename(name)] = readFileSync(file).toString("base64");
  }
  const plain = gzipSync(Buffer.from(JSON.stringify({ version: 1, meta, files }), "utf8"), { level: 9 });
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(MAGIC);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, ciphertext]);
}

/** Decrypt a .nrs bundle into a normal local snapshot directory. */
export function decryptSnapshot(bundle, passphrase, destinationRoot) {
  const data = Buffer.isBuffer(bundle) ? bundle : Buffer.from(bundle);
  const minimum = MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES + 1;
  if (data.length < minimum || !data.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("remote snapshot: invalid bundle format");
  }
  let offset = MAGIC.length;
  const salt = data.subarray(offset, offset += SALT_BYTES);
  const iv = data.subarray(offset, offset += IV_BYTES);
  const tag = data.subarray(offset, offset += TAG_BYTES);
  const ciphertext = data.subarray(offset);
  const key = scryptSync(passphrase, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  let payload;
  try {
    payload = JSON.parse(gunzipSync(Buffer.concat([decipher.update(ciphertext), decipher.final()])).toString("utf8"));
  } catch {
    throw new Error("remote snapshot: decryption failed (wrong key or corrupted bundle)");
  }
  if (payload?.version !== 1 || !payload.meta?.label || typeof payload.files !== "object") {
    throw new Error("remote snapshot: decrypted payload is invalid");
  }
  const label = basename(payload.meta.label);
  const dir = join(resolve(destinationRoot), "data", "snapshots", label);
  mkdirSync(dir, { recursive: true });
  const written = [];
  for (const [name, encoded] of Object.entries(payload.files)) {
    const safe = basename(name);
    if (!safe.endsWith(".db") || typeof encoded !== "string") continue;
    writeFileSync(join(dir, safe), Buffer.from(encoded, "base64"));
    written.push(safe);
  }
  const meta = { ...payload.meta, label, files: written, remote: true };
  writeFileSync(join(dir, "snapshot.json"), JSON.stringify(meta));
  return { label, dir, files: written, meta };
}

function amzTime(now) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/** Build a native AWS Signature V4 request. Exported so signing is testable. */
export function signS3Request(config, { method, key = "", query = "", body = Buffer.alloc(0), now = new Date() }) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const dateTime = amzTime(now);
  const date = dateTime.slice(0, 8);
  const objectPath = [config.endpoint.pathname.replace(/^\/+|\/+$/g, ""), encodeURIComponent(config.bucket), encodePath(key)]
    .filter(Boolean).join("/");
  const path = "/" + objectPath;
  const url = new URL(config.endpoint.origin + path + (query ? `?${query}` : ""));
  const payloadHash = sha256(payload);
  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": dateTime,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join("");
  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", dateTime, scope, sha256(canonicalRequest)].join("\n");
  const dateKey = hmac(`AWS4${config.secretKey}`, date);
  const regionKey = hmac(dateKey, config.region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmac(signingKey, stringToSign, "hex");
  return {
    url,
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: payload,
  };
}

async function s3(config, request, fetchImpl = globalThis.fetch) {
  const signed = signS3Request(config, request);
  const headers = { ...signed.headers };
  if (request.body?.length) headers["content-type"] = CONTENT_TYPE;
  const response = await fetchImpl(signed.url, { method: request.method, headers, body: request.method === "GET" || request.method === "DELETE" ? undefined : signed.body });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`remote snapshot: S3 ${request.method} failed (${response.status})${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }
  return response;
}

const objectKey = (config, label) => `${config.prefix}/${basename(label)}.nrs`;

function xmlValues(xml, tag) {
  const values = [];
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "g");
  let match;
  while ((match = pattern.exec(xml))) values.push(match[1].replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">"));
  return values;
}

/** List encrypted remote snapshots, newest label first. */
export async function listRemoteSnapshots({ config = remoteSnapshotConfig(), fetchImpl = globalThis.fetch } = {}) {
  const query = `list-type=2&prefix=${encodeURIComponent(config.prefix + "/")}`;
  const response = await s3(config, { method: "GET", query }, fetchImpl);
  const xml = await response.text();
  return xmlValues(xml, "Key")
    .filter((key) => key.startsWith(config.prefix + "/") && key.endsWith(".nrs"))
    .map((key) => ({ key, label: basename(key, ".nrs") }))
    .sort((a, b) => b.label.localeCompare(a.label));
}

/** Encrypt and upload an existing local snapshot. */
export async function pushRemoteSnapshot(projectRoot, label, { config = remoteSnapshotConfig(), fetchImpl = globalThis.fetch, prune = true } = {}) {
  const local = listSnapshots(projectRoot).find((item) => item.label === label);
  if (!local) throw new Error(`remote snapshot: local snapshot '${label}' not found`);
  const bundle = encryptSnapshot(local.dir, config.encryptionKey);
  const key = objectKey(config, label);
  await s3(config, { method: "PUT", key, body: bundle }, fetchImpl);
  const digest = sha256(bundle);
  if (prune) {
    const remote = await listRemoteSnapshots({ config, fetchImpl });
    for (const old of remote.slice(config.keep)) await s3(config, { method: "DELETE", key: old.key }, fetchImpl);
  }
  return { label, key, bytes: bundle.length, sha256: digest };
}

/** Create a local snapshot and immediately push its encrypted form off-box. */
export async function snapshotRemote(projectRoot, options = {}) {
  const local = snapshot(projectRoot, { reason: options.reason || "remote" });
  const remote = await pushRemoteSnapshot(projectRoot, local.label, options);
  return { local, remote };
}

/** Download + decrypt a remote snapshot into data/snapshots/. */
export async function pullRemoteSnapshot(projectRoot, label, { config = remoteSnapshotConfig(), fetchImpl = globalThis.fetch } = {}) {
  const response = await s3(config, { method: "GET", key: objectKey(config, label) }, fetchImpl);
  const bundle = Buffer.from(await response.arrayBuffer());
  return decryptSnapshot(bundle, config.encryptionKey, projectRoot);
}

/** Pull a remote snapshot, then use the existing safe local restore flow. */
export async function restoreRemoteSnapshot(projectRoot, label, options = {}) {
  const pulled = await pullRemoteSnapshot(projectRoot, label, options);
  const restored = restore(projectRoot, pulled.label);
  return { pulled, restored };
}
