/**
 * niral add fonts — self-hosted Google Fonts, no npm, no tracking.
 *
 * Fetches the font CSS from Google's API, downloads every woff2 file into
 * styles/fonts/, rewrites the CSS to local paths, and links it in the shell.
 * Result: fonts served from YOUR domain (privacy + offline + no FOUT from
 * third-party latency), zero runtime dependency on Google.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { DEFAULT_SHELL } from "../server/page.js";

// a modern browser UA makes Google return woff2 (default UA gets legacy ttf)
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** Extract unique remote font URLs from a Google Fonts stylesheet. */
export function parseFontUrls(css) {
  return [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
}

export async function addFonts({ root = ".", family = "Inter" } = {}) {
  const dir = resolve(root);
  const fam = family.trim();
  const apiUrl =
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, "+")}` +
    `:wght@400;500;600;700&display=swap`;

  console.log(`niral · fetching "${fam}" from Google Fonts…`);
  const res = await fetch(apiUrl, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`font not found: "${fam}" (HTTP ${res.status})`);
  let css = await res.text();

  const urls = parseFontUrls(css);
  if (!urls.length) throw new Error(`no font files returned for "${fam}"`);

  const fontsDir = join(dir, "styles", "fonts");
  mkdirSync(fontsDir, { recursive: true });
  for (const url of urls) {
    const name = basename(new URL(url).pathname);
    const fres = await fetch(url);
    if (!fres.ok) throw new Error(`font file download failed: ${url}`);
    writeFileSync(join(fontsDir, name), Buffer.from(await fres.arrayBuffer()));
    css = css.split(url).join(`/styles/fonts/${name}`);
  }

  const cssFile = join(dir, "styles", "fonts.css");
  const marker = `/* niral fonts: ${fam} */`;
  const existing = existsSync(cssFile) ? readFileSync(cssFile, "utf8") : "";
  if (!existing.includes(marker)) {
    writeFileSync(cssFile, `${existing}${existing ? "\n" : ""}${marker}\n${css}`);
  }

  // link in the shell
  const shellAbs = join(dir, "routes", "_shell.html");
  const linkTag = `<link rel="stylesheet" href="/styles/fonts.css" />`;
  if (!existsSync(shellAbs)) {
    mkdirSync(dirname(shellAbs), { recursive: true });
    writeFileSync(shellAbs, DEFAULT_SHELL.replace("<!--niral:head-->", `${linkTag}\n<!--niral:head-->`));
  } else {
    const shell = readFileSync(shellAbs, "utf8");
    if (!shell.includes("/styles/fonts.css")) {
      writeFileSync(
        shellAbs,
        shell.includes("<!--niral:head-->")
          ? shell.replace("<!--niral:head-->", `${linkTag}\n<!--niral:head-->`)
          : shell.replace("</head>", `${linkTag}\n</head>`)
      );
    }
  }

  console.log(`niral · "${fam}" self-hosted (${urls.length} files) — use: font-family: "${fam}", sans-serif`);
  return { family: fam, files: urls.length, css: "styles/fonts.css" };
}
