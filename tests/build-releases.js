import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { syncBuiltinESMExports } from "node:module";
import { build } from "../src/build/build.js";
import { hashRelease } from "../src/server/integrity.js";

function fixture(run) {
  const root = fs.mkdtempSync(join(tmpdir(), "niral-release-"));
  fs.mkdirSync(join(root, "routes"));
  fs.writeFileSync(join(root, "routes", "index.niral"), "<h1>Release safety</h1>");
  try { return run(root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

export function registerBuildReleaseTests(test) {
  test("release: identical rebuild preserves published bytes and directory", () => fixture(root => {
    const first = build({ root });
    const before = hashRelease(first.release);
    const inode = fs.statSync(first.release).ino;
    const second = build({ root });
    assert.equal(second.hash, first.hash);
    assert.equal(fs.statSync(second.release).ino, inode);
    assert.deepEqual(hashRelease(second.release), before);
    assert.deepEqual(fs.readdirSync(join(root, "dist")).sort(), ["current", "releases"]);
  }));

  test("release: mid-write failure preserves active files and cleans staging", () => fixture(root => {
    const first = build({ root });
    const before = hashRelease(first.release);
    const originalCopy = fs.cpSync;
    fs.cpSync = () => { throw new Error("injected copy failure"); };
    syncBuiltinESMExports();
    try { assert.throws(() => build({ root }), /injected copy failure/); }
    finally { fs.cpSync = originalCopy; syncBuiltinESMExports(); }
    assert.equal(fs.realpathSync(join(root, "dist", "current")), fs.realpathSync(first.release));
    assert.deepEqual(hashRelease(first.release), before);
    assert.deepEqual(fs.readdirSync(join(root, "dist")).sort(), ["current", "releases"]);
  }));

  test("release: changed framework input changes asset identity", () => fixture(root => {
    const first = build({ root });
    const originalRead = fs.readFileSync;
    const runtime = fileURLToPath(new URL("../src/runtime/rpc.js", import.meta.url));
    fs.readFileSync = (file, options) => {
      const value = originalRead(file, options);
      if (String(file) !== runtime) return value;
      return typeof value === "string" ? value + "\n" : Buffer.concat([value, Buffer.from("\n")]);
    };
    syncBuiltinESMExports();
    try {
      const second = build({ root });
      assert.notEqual(second.hash, first.hash);
      const manifest = JSON.parse(originalRead(join(second.release, "manifest.json"), "utf8"));
      assert.ok(manifest.routes[0].client.startsWith(`/assets/${second.hash}/`));
      assert.ok(fs.existsSync(first.release));
    } finally { fs.readFileSync = originalRead; syncBuiltinESMExports(); }
  }));

  test("release: tampered existing release is not silently overwritten", () => fixture(root => {
    const first = build({ root });
    const file = join(first.release, "assets", "routes", "index.js");
    fs.writeFileSync(file, "tampered");
    assert.throws(() => build({ root }), /integrity validation/);
    assert.equal(fs.readFileSync(file, "utf8"), "tampered");
  }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { test } = await import("node:test");
  registerBuildReleaseTests(test);
}