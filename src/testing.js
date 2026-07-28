/**
 * Niral — testing utilities (`import { renderSource, renderRoute } from "niral/testing"`).
 *
 * Render components in plain Node — no browser, no server, zero setup:
 *
 *   import { renderSource } from "niral/src/testing.js";
 *   const { html, contains } = await renderSource(
 *     `<script>let n = $state(2)</script><p>Count {n}</p>`
 *   );
 *   assert(contains("Count 2"));
 *
 * `renderRoute(file, props)` renders a real component file (imports,
 * scoped styles and child components all resolve).
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderFile } from "./server/render.js";

/** Render inline component source → { html, ast, contains(text) }. */
export async function renderSource(source, props = {}, { ext = "niral" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "niral-test-"));
  const file = join(dir, `component.${ext}`);
  writeFileSync(file, source);
  return renderRoute(file, props);
}

/** Render a component FILE → { html, ast, contains(text) }. */
export async function renderRoute(file, props = {}) {
  const { html, ast } = await renderFile(file, props);
  return {
    html,
    ast,
    /** Case-sensitive substring check with a helpful failure message. */
    contains(text) {
      if (html.includes(text)) return true;
      throw new Error(`expected rendered html to contain ${JSON.stringify(text)}\n--- html ---\n${html}`);
    },
  };
}
