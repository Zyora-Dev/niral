/**
 * niral add image --transcode — REAL image transcoding via Google's libwebp.
 *
 * Like the Tailwind recipe: one command downloads the official precompiled
 * `cwebp` binary (no npm, framework stays zero-dep). From then on `niral
 * build` transcodes every raster image it copies into a release:
 *
 *   static  hero.jpg (1800px)  →  hero.webp             (full size, q80)
 *                                 hero-480.webp  480w
 *                                 hero-960.webp  960w
 *                                 hero-1600.webp 1600w   (never upscaled)
 *
 * Wire them with the scaffolded <Img>:
 *   <Img src="/hero.webp" srcset="/hero-480.webp 480w, /hero-960.webp 960w"
 *        sizes="(max-width: 600px) 100vw, 600px" width={1800} height={1200} />
 *
 * Results are cached in .niral/imgcache/ by content hash — rebuilds are free.
 */

import {
  writeFileSync, readFileSync, mkdirSync, existsSync, chmodSync, cpSync, statSync, openSync, readSync, closeSync,
} from "node:fs";
import { join, resolve, extname, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { untar } from "./typescript.js";

export const LIBWEBP_VERSION = "1.5.0";
const BASE = "https://storage.googleapis.com/downloads.webmproject.org/releases/webp";
export const DEFAULT_WIDTHS = [480, 960, 1600];
const QUALITY = 80;

/** The official precompiled archive for this platform. */
export function libwebpAsset(platform = process.platform, arch = process.arch) {
  if (platform === "darwin") return `libwebp-${LIBWEBP_VERSION}-mac-${arch === "arm64" ? "arm64" : "x86-64"}.tar.gz`;
  if (platform === "linux") return `libwebp-${LIBWEBP_VERSION}-linux-${arch === "arm64" ? "aarch64" : "x86-64"}.tar.gz`;
  throw new Error(`no prebuilt libwebp for ${platform}/${arch} — install cwebp yourself and set NIRAL_CWEBP`);
}

/** Resolve the cwebp binary (env → .niral/bin → null). */
export function cwebpPath(root) {
  if (process.env.NIRAL_CWEBP && existsSync(process.env.NIRAL_CWEBP)) return process.env.NIRAL_CWEBP;
  const local = join(resolve(root), ".niral", "bin", "cwebp");
  return existsSync(local) ? local : null;
}

/** Download the official cwebp binary into .niral/bin/. */
export async function addImageTranscode({ root }) {
  const dir = resolve(root);
  const dest = join(dir, ".niral", "bin", "cwebp");
  if (existsSync(dest)) {
    console.log("niral · cwebp already installed — builds transcode images automatically");
    return dest;
  }
  const asset = libwebpAsset();
  const url = `${BASE}/${asset}`;
  console.log(`niral · downloading libwebp ${LIBWEBP_VERSION} (one-time, official Google build) …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
  const tarball = gunzipSync(Buffer.from(await res.arrayBuffer()));
  mkdirSync(dirname(dest), { recursive: true });
  let found = false;
  for (const { name, data } of untar(tarball)) {
    if (name.endsWith("/bin/cwebp")) {
      writeFileSync(dest, data);
      chmodSync(dest, 0o755);
      found = true;
      break;
    }
  }
  if (!found) throw new Error("archive had no bin/cwebp — unexpected layout");
  // sanity: does it run here?
  const probe = spawnSync(dest, ["-version"], { encoding: "utf8" });
  if (probe.status !== 0) throw new Error(`cwebp downloaded but won't run: ${probe.stderr || probe.error?.message}`);
  console.log(`niral · cwebp ${probe.stdout.trim()} ready — \`niral build\` now emits .webp variants for every image`);
  return dest;
}

/* ── image dimensions (headers only — no decoder needed) ── */

/** Width in pixels of a PNG/JPEG file, or null. */
export function imageWidth(file) {
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(32);
    readSync(fd, head, 0, 32, 0);
    // PNG: IHDR width at offset 16
    if (head.readUInt32BE(0) === 0x89504e47) return head.readUInt32BE(16);
    // JPEG: scan segments for a SOFn marker
    if (head[0] === 0xff && head[1] === 0xd8) {
      const size = statSync(file).size;
      const buf = Buffer.alloc(Math.min(size, 65536));
      readSync(fd, buf, 0, buf.length, 0);
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) break;
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return buf.readUInt16BE(i + 7); // SOFn: [len][precision][height][width]
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
    return null;
  } finally {
    closeSync(fd);
  }
}

const RASTER = new Set([".png", ".jpg", ".jpeg"]);

/**
 * Transcode one source image → { outputs: [{name, width|null}] }.
 * Writes into destDir next to the copied original; caches by content hash.
 */
export function transcodeImage(bin, src, destDir, cacheDir, widths = DEFAULT_WIDTHS) {
  const base = basename(src).replace(/\.[^.]+$/, "");
  const hash = createHash("sha256").update(readFileSync(src)).digest("hex").slice(0, 16);
  const srcWidth = imageWidth(src);
  const variants = [
    { suffix: "", resize: null }, // full-size webp
    ...widths.filter((w) => srcWidth == null || w < srcWidth).map((w) => ({ suffix: `-${w}`, resize: w })),
  ];
  const outputs = [];
  mkdirSync(cacheDir, { recursive: true });
  for (const { suffix, resize } of variants) {
    const outName = `${base}${suffix}.webp`;
    const cached = join(cacheDir, `${hash}${suffix}.webp`);
    const dest = join(destDir, outName);
    if (!existsSync(cached)) {
      const args = ["-quiet", "-q", String(QUALITY), ...(resize ? ["-resize", String(resize), "0"] : []), src, "-o", cached];
      const r = spawnSync(bin, args, { encoding: "utf8" });
      if (r.status !== 0) throw new Error(`cwebp failed on ${src}: ${r.stderr || r.error?.message}`);
    }
    cpSync(cached, dest);
    outputs.push({ name: outName, width: resize });
  }
  return { outputs };
}

/**
 * Build hook: transcode every raster image in a release's static tree.
 * No-op unless the project has the cwebp binary. Returns a count.
 */
export function transcodeStatic(root, staticDir, relFiles) {
  const bin = cwebpPath(root);
  if (!bin) return 0;
  const cacheDir = join(resolve(root), ".niral", "imgcache");
  let made = 0;
  for (const rel of relFiles) {
    if (!RASTER.has(extname(rel).toLowerCase())) continue;
    const src = join(resolve(root), rel);
    const { outputs } = transcodeImage(bin, src, join(staticDir, dirname(rel)), cacheDir);
    made += outputs.length;
  }
  if (made) console.log(`niral · images: ${made} webp variant(s) generated (cached in .niral/imgcache)`);
  return made;
}
