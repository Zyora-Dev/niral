/**
 * `niral add image` — scaffold a best-practice <Img> component.
 *
 * Zero-dependency image OPTIMIZATION (transcoding to WebP/AVIF, resizing)
 * needs native codecs — that's a hosting/CDN concern or a future binary
 * recipe. What a framework CAN guarantee is that images never wreck your
 * page: this component bakes in lazy loading, async decode, explicit
 * dimensions (no layout shift), fetch priority and srcset/sizes support.
 * It's scaffolded INTO your project — read it, tweak it, own it.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const IMG_COMPONENT = `<script>
  let {
    src,
    alt = "",
    width,
    height,
    priority = false,   // above the fold? eager + high priority
    sizes,              // e.g. "(max-width: 600px) 100vw, 600px"
    srcset,             // e.g. "/img/a-480.webp 480w, /img/a-960.webp 960w"
  } = $props
</script>

<img
  src={src}
  alt={alt}
  width={width}
  height={height}
  loading={priority ? "eager" : "lazy"}
  decoding={priority ? "sync" : "async"}
  fetchpriority={priority ? "high" : "auto"}
  sizes={sizes}
  srcset={srcset}
  style:aspect-ratio={width && height ? width + " / " + height : null}
/>

<style>
  img {
    max-width: 100%;
    height: auto;
    display: block;
  }
</style>
`;

export async function addImage({ root = "." } = {}) {
  const dir = resolve(root);
  const out = join(dir, "components", "Img.niral");
  if (existsSync(out)) {
    console.log("niral · components/Img.niral already exists — leaving it alone");
    return { file: out, created: false };
  }
  mkdirSync(join(dir, "components"), { recursive: true });
  writeFileSync(out, IMG_COMPONENT);
  console.log(`niral · components/Img.niral ready — import Img from "../components/Img.niral"`);
  console.log(`niral · lazy + async decode + no layout shift by default; priority={true} for hero images`);
  return { file: out, created: true };
}
