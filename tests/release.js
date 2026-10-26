import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const env = { ...process.env };
delete env.NIRAL_BROWSER_FILTER;
env.NIRAL_TSC ||= join(root, ".niral/lib/typescript/typescript.js");
env.NIRAL_CONTACT_BROWSER = "1";
env.NIRAL_SEO_BROWSER = "1";

function run(command, args, capture = false, overrides = {}) {
  const result = spawnSync(command, args, { cwd: root, env: { ...env, ...overrides }, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.error || result.status !== 0) {
    if (capture) process.stderr.write(result.stderr || result.stdout || "");
    throw new Error(`${command} ${args.join(" ")} failed (${result.error?.message || result.signal || result.status})`);
  }
  return result.stdout;
}

try {
  assert.ok(Number(process.versions.node.split(".")[0]) >= 22, "Node.js 22 or newer is required");
  assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).dependencies, {});
  assert.ok(existsSync(env.NIRAL_TSC), "Set NIRAL_TSC to an installed TypeScript lib/typescript.js before running the release gate");
  const { chromium } = createRequire(new URL("./browser/package.json", import.meta.url))("playwright");
  assert.ok(existsSync(chromium.executablePath()), "Install Chromium in tests/browser before running the release gate");
  if (env.NIRAL_RELEASE_EXTENDED === "1") {
    assert.ok(env.NIRAL_TEST_PG_URL, "Extended release checks require a disposable NIRAL_TEST_PG_URL");
    assert.ok(env.NIRAL_CWEBP && existsSync(env.NIRAL_CWEBP), "Extended release checks require NIRAL_CWEBP");
  }
  console.log(`Release gates: Postgres ${env.NIRAL_TEST_PG_URL ? "enabled" : "not configured"}; image pipeline ${env.NIRAL_CWEBP ? "enabled" : "not configured"}`);
  run(process.execPath, ["tests/run.js"]);
  run(process.execPath, ["--test", "--test-concurrency=1", "tests/niralscript.js", "tests/devtools.js", "tests/docs-contact.js", "tests/docs-seo.js"]);
  run(process.execPath, ["tests/browser/run.js"]);
  run(process.execPath, ["tests/browser/forms.js"]);
  const expected = ["README.md", "bin/create-niral.js", "bin/niral.js", "index.js", "package.json"].sort();
  const temporary = mkdtempSync(join(tmpdir(), "niral-release-pack-"));
  try {
    const windows = process.platform === "win32";
    if (windows) assert.ok(env.npm_execpath && existsSync(env.npm_execpath), "Run the Windows release gate through npm run test:release");
    const npm = (args, overrides = {}) => run(windows ? process.execPath : "npm", windows ? [env.npm_execpath, ...args] : args, true, overrides);
    for (const name of ["niral", "create-niral"]) {
      const manifest = JSON.parse(readFileSync(join(root, "installer", name, "package.json"), "utf8"));
      assert.deepEqual(manifest.dependencies, {});
      assert.equal(manifest.engines.node, ">=22");
      const packed = JSON.parse(npm(["pack", `./installer/${name}`, "--pack-destination", temporary, "--ignore-scripts", "--json"]));
      assert.equal(packed.length, 1);
      assert.deepEqual(packed[0].files.map(file => file.path).sort(), expected);
      const home = join(temporary, name);
      const framework = join(home, ".niral", "framework");
      const overrides = { HOME: home, USERPROFILE: home, NIRAL_HOME: join(home, ".niral"), NIRAL_REF: "main", npm_config_cache: join(home, ".npm"), SHELL: "/bin/zsh" };
      npm(["install", "--prefix", home, "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", join(temporary, packed[0].filename)], overrides);
      const entry = join(home, "node_modules", name, "bin", "niral.js");
      run(process.execPath, [entry, "--help"], true, overrides);
      run(process.execPath, [entry, "--version"], true, overrides);
      assert.equal(existsSync(framework), false, "help/version must not download a framework");
      mkdirSync(framework, { recursive: true });
      for (const file of ["src", "niralscript", "bin", "assets", "installer", "package.json"]) cpSync(join(root, file), join(framework, file), { recursive: true });
      const app = join(home, "app");
      run(process.execPath, [join(home, "node_modules", name, "bin", "create-niral.js"), app], true, overrides);
      run(process.execPath, [entry, "build", app], true, overrides);
      run(process.execPath, [entry, "test", app], true, overrides);
      console.log(`Verified ${name}@${manifest.version}: five files, installed scaffold/build/test; sha1 ${packed[0].shasum}`);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  console.log("Release checks passed. Nothing was published or deployed.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}