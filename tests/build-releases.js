import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { syncBuiltinESMExports } from "node:module";
import { build } from "../src/build/build.js";
import { hashRelease } from "../src/server/integrity.js";
import { activateRelease } from "../src/server/recover.js";

function fixture(run) {
  const root = fs.mkdtempSync(join(tmpdir(), "niral-release-"));
  fs.mkdirSync(join(root, "routes"));
  fs.writeFileSync(join(root, "routes", "index.niral"), "<h1>Release safety</h1>");
  try { return run(root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

export function registerBuildReleaseTests(test) {
  test("release: external NiralScript changes identity without publishing raw sources", () => fixture(root => {
    fs.writeFileSync(join(root, "routes", "index.niral"), '<script lang="niralscript" src="../counter.nrs"></script><p>{count}</p>');
    fs.writeFileSync(join(root, "counter.nrs"), 'import { initial } from "./math.nrs"\nstate count = initial');
    fs.writeFileSync(join(root, "math.nrs"), 'import { base } from "./base.nrs"\nexport const initial = base');
    fs.writeFileSync(join(root, "base.nrs"), "export const base = 1");
    fs.writeFileSync(join(root, "private.NRS"), "NEVER_PUBLIC");
    const first = build({ root });
    const files = fs.readdirSync(first.release, { recursive: true });
    assert.ok(files.every(file => !/\.nrs$/i.test(file)));
    fs.writeFileSync(join(root, "base.nrs"), "export const base = 2");
    const second = build({ root });
    assert.notEqual(first.hash, second.hash);
    assert.ok(fs.existsSync(first.release));
    fs.writeFileSync(join(root, "base.nrs"), "export const base = missing");
    assert.throws(() => build({ root }), { code: "NIRAL073" });
    assert.equal(fs.realpathSync(join(root, "dist", "current")), fs.realpathSync(second.release));
  }));

  test("release: Windows activation restores the previous junction on promotion failure", () => fixture(root => {
    const dist = join(root, "dist");
    const current = join(dist, "current");
    for (const name of ["first", "second"]) fs.mkdirSync(join(dist, "releases", name), { recursive: true });
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    const rename = fs.renameSync;
    Object.defineProperty(process, "platform", { ...platform, value: "win32" });
    try {
      activateRelease(dist, "first");
      fs.renameSync = (source, destination) => {
        if (destination === current && !String(source).endsWith(".previous")) throw new Error("injected promotion failure");
        return rename(source, destination);
      };
      syncBuiltinESMExports();
      assert.throws(() => activateRelease(dist, "second"), /injected promotion failure/);
      assert.equal(fs.realpathSync(current), fs.realpathSync(join(dist, "releases", "first")));
      assert.deepEqual(fs.readdirSync(dist).sort(), ["current", "releases"]);
      fs.renameSync = rename;
      syncBuiltinESMExports();
      activateRelease(dist, "second");
      assert.equal(fs.realpathSync(current), fs.realpathSync(join(dist, "releases", "second")));
      assert.ok(fs.existsSync(join(dist, "releases", "first")));
      assert.deepEqual(fs.readdirSync(dist).sort(), ["current", "releases"]);
      fs.mkdirSync(join(dist, ".current-lock"));
      assert.throws(() => activateRelease(dist, "first"), { code: "EEXIST" });
      assert.equal(fs.realpathSync(current), fs.realpathSync(join(dist, "releases", "second")));
      assert.ok(fs.existsSync(join(dist, ".current-lock")));
    } finally {
      fs.renameSync = rename;
      syncBuiltinESMExports();
      Object.defineProperty(process, "platform", platform);
    }
  }));

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
    const hashes = new Set([first.hash]);
    let previous = first;
    for (const path of ["../src/runtime/rpc.js", "../niralscript/parser.js", "../niralscript/scanner.js", "../niralscript/errors.js", "../niralscript/expressions.js", "../niralscript/analysis.js", "../niralscript/modules.js"]) {
      const input = fileURLToPath(new URL(path, import.meta.url));
      fs.readFileSync = (file, options) => {
        const value = originalRead(file, options);
        if (String(file) !== input) return value;
        return typeof value === "string" ? value + "\n" : Buffer.concat([value, Buffer.from("\n")]);
      };
      syncBuiltinESMExports();
      try {
        const second = build({ root });
        assert.ok(!hashes.has(second.hash), path);
        hashes.add(second.hash);
        const manifest = JSON.parse(originalRead(join(second.release, "manifest.json"), "utf8"));
        assert.ok(manifest.routes[0].client.startsWith(`/assets/${second.hash}/`));
        assert.ok(fs.existsSync(previous.release));
        previous = second;
      } finally { fs.readFileSync = originalRead; syncBuiltinESMExports(); }
    }
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