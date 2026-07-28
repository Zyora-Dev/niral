/**
 * niral add llm — a LOCAL OpenAI-compatible model server (no npm, no cloud).
 *
 * Downloads the official llama.cpp `llama-server` build for this platform
 * (github.com/ggml-org/llama.cpp releases — same trusted-binary pattern as
 * the tailwind/cwebp recipes) into .niral/llm/. llama-server speaks the
 * OpenAI wire format at /v1, so the ambient `ai.*` works against it as-is:
 *
 *   niral add llm [--model <gguf-url>]
 *   .niral/llm/llama-server -m models/<model>.gguf --port 8033
 *   NIRAL_AI_URL=http://localhost:8033/v1 niral dev
 *
 * Models are GGUF files the user picks (they're GBs — never auto-downloaded
 * unless --model is passed). Zip extraction is hand-rolled: EOCD → central
 * directory → local headers, stored or deflate via node:zlib.
 */

import { writeFileSync, mkdirSync, existsSync, chmodSync, createWriteStream } from "node:fs";
import { join, resolve, basename } from "node:path";
import { inflateRawSync } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Pick the official release asset for this platform (pure — tested). */
export function llamaAsset(assets, platform = process.platform, arch = process.arch) {
  const names = assets.map((a) => (typeof a === "string" ? a : a.name));
  const pick = (re) => names.find((n) => re.test(n));
  let name = null;
  if (platform === "darwin") name = pick(arch === "arm64" ? /bin-macos-arm64\.zip$/ : /bin-macos-x64\.zip$/);
  else if (platform === "linux") name = pick(arch === "arm64" ? /bin-ubuntu-arm64\.zip$/ : /bin-ubuntu-x64\.zip$/);
  if (!name) {
    throw new Error(
      `no prebuilt llama.cpp server for ${platform}/${arch} — build llama.cpp yourself and point NIRAL_AI_URL at it`
    );
  }
  return name;
}

/** Minimal zip reader: yields { name, data } for every file entry. */
export function* unzip(buf) {
  // EOCD record — scan back for the signature
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a zip: no end-of-central-directory record");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("corrupt central directory");
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    // local header: sizes may differ — trust the central directory's csize
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + csize);
    if (!name.endsWith("/")) {
      yield { name, data: method === 8 ? inflateRawSync(raw) : raw };
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
}

export async function addLlm({ root, modelUrl = null }) {
  const dir = resolve(root);
  const dest = join(dir, ".niral", "llm");
  const serverBin = join(dest, "llama-server");

  if (!existsSync(serverBin)) {
    console.log("niral · finding the latest llama.cpp release …");
    const rel = await (await fetch("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest", {
      headers: { accept: "application/vnd.github+json", "user-agent": "niral" },
    })).json();
    if (!Array.isArray(rel.assets)) throw new Error(`release lookup failed: ${rel.message ?? "no assets"}`);
    const assetName = llamaAsset(rel.assets);
    const asset = rel.assets.find((a) => a.name === assetName);
    console.log(`niral · downloading ${assetName} (${(asset.size / 1e6).toFixed(0)} MB, one-time, official build) …`);
    const res = await fetch(asset.browser_download_url);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    const zip = Buffer.from(await res.arrayBuffer());

    mkdirSync(dest, { recursive: true });
    let wrote = 0;
    for (const { name, data } of unzip(zip)) {
      // the archives nest under build/bin/ — flatten, keep dylibs beside the binary
      if (!/\/bin\//.test(name) && !/^bin\//.test(name)) continue;
      const out = join(dest, basename(name));
      writeFileSync(out, data);
      chmodSync(out, 0o755);
      wrote++;
    }
    if (!existsSync(serverBin)) throw new Error("archive had no llama-server — unexpected layout");
    console.log(`niral · llama-server ready (${wrote} files) — .niral/llm/`);
  } else {
    console.log("niral · llama-server already installed — .niral/llm/");
  }

  mkdirSync(join(dir, "models"), { recursive: true });
  if (modelUrl) {
    const file = join(dir, "models", basename(new URL(modelUrl).pathname));
    if (!existsSync(file)) {
      console.log(`niral · downloading model ${basename(file)} …`);
      const res = await fetch(modelUrl);
      if (!res.ok) throw new Error(`model download failed: ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
      console.log(`niral · model saved — models/${basename(file)}`);
    }
  }

  console.log(`
niral · fully local AI — no cloud, no keys:
  1. put a GGUF model in models/   (e.g. Qwen2.5-0.5B-Instruct from huggingface.co,
     or rerun with --model <direct-gguf-url>)
  2. .niral/llm/llama-server -m models/<model>.gguf --port 8033
  3. NIRAL_AI_URL=http://localhost:8033/v1 niral dev
  → ai.chat() / ai.stream() / the chat scaffold now run entirely on this machine`);
  return dest;
}
