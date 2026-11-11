// Real verification: assert that a genuine `next build` compiled the .nrs file
// through @niral/next's loader and bundled it into the client chunks.
// Run AFTER `npm run build`. No mocks — this inspects real build output.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL(".", import.meta.url).pathname;
const chunkDir = join(root, ".next", "static", "chunks");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".js")) out.push(full);
  }
  return out;
}

const files = walk(chunkDir);
assert.ok(files.length > 0, "next build produced client chunks");

const haystack = files.map((f) => readFileSync(f, "utf8")).join("\n");
assert.ok(
  haystack.includes("createInstance"),
  "compiled NiralScript createInstance is present in the client bundle",
);
assert.ok(
  haystack.includes("increment"),
  "the .nrs exported function is present in the client bundle",
);

console.log(
  `PASS: real next build bundled the compiled .nrs into ${files.length} client chunk(s).`,
);
