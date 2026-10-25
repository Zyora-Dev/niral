import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, readdirSync, mkdirSync, writeFileSync, existsSync, symlinkSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const cli = fileURLToPath(new URL("../bin/niral.js", import.meta.url));
const packages = ["niral", "create-niral"];
const installer = (name, file) => fileURLToPath(new URL(`../installer/${name}/${file}`, import.meta.url));
const fixtureCli = `console.log(JSON.stringify({ args: process.argv.slice(2), home: process.env.NIRAL_HOME })); process.exitCode = Number(process.env.FIXTURE_EXIT || 0);`;

function writeFramework(root, code = fixtureCli) {
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "bin", "niral.js"), code);
  writeFileSync(join(root, "src", "index.js"), "export {};\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "niral", version: "fixture", type: "module" }));
}

const offlineLoader = `
import childProcess from "node:child_process";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { readFileSync, appendFileSync, cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const original = childProcess.spawnSync;
const scenario = process.env.FIXTURE_SCENARIO;
const success = (stdout = "") => ({ status: 0, stdout, stderr: "" });
childProcess.spawnSync = (command, args, options) => {
  if (command !== "git") return original(command, args, options);
  appendFileSync(process.env.FIXTURE_CALLS, JSON.stringify(args) + "\\n");
  if (scenario === "archive" || scenario === "network-failure" || scenario === "no-git") return { status: 1, stdout: "", stderr: "no git" };
  if (args[0] === "--version") return success("git fixture");
  if (args[0] === "status") return success(scenario === "dirty" ? " M edited.js" : "");
  if (args[0] === "branch") return success(scenario === "branch" ? "custom" : scenario === "pinned" ? "" : "main");
  if (args[0] === "remote") return success(scenario === "origin" ? "https://example.invalid/custom.git" : "https://github.com/Zyora-Dev/niral.git");
  if (args[0] === "rev-parse") return success(process.env.FIXTURE_REVISION || "fixture-revision");
  if (args[0] === "checkout") return scenario === "checkout-failure" ? { status: 1, stderr: "invalid pin" } : success();
  if (args[0] === "pull") {
    if (scenario === "pull-failure") return { status: 1, stdout: "", stderr: "simulated failure" };
    writeFileSync(join(options.cwd, "updated"), "yes");
    return success();
  }
  if (args[0] === "clone") {
    cpSync(process.env.FIXTURE_DOWNLOAD, args.at(-1), { recursive: true });
    return success();
  }
  throw new Error("Unexpected Git operation");
};
https.get = (url, callback) => {
  appendFileSync(process.env.FIXTURE_CALLS, "download " + url + "\\n");
  const request = new EventEmitter();
  request.destroy = (error) => { request.emit("error", error); request.emit("close"); };
  process.nextTick(() => {
    if (scenario === "network-failure") return request.destroy(new Error("simulated network failure"));
    const response = Readable.from([readFileSync(process.env.FIXTURE_ARCHIVE)]);
    response.statusCode = 200;
    response.on("close", () => request.emit("close"));
    callback(response);
  });
  return request;
};
syncBuiltinESMExports();
`;

function withInstallation(run) {
  const root = mkdtempSync(join(tmpdir(), "niral-installer-"));
  const home = join(root, "custom 'home $literal");
  const framework = join(home, "framework");
  const env = { ...process.env, HOME: root, USERPROFILE: root, SHELL: "/bin/zsh", NIRAL_HOME: home, FIXTURE_CALLS: join(root, "calls"), FIXTURE_DOWNLOAD: join(root, "download") };
  const execute = (file, args = [], extra = {}) => spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(offlineLoader)}`, file, ...args], { cwd: root, env: { ...env, ...extra }, encoding: "utf8", timeout: 15000 });
  try {
    return run({ root, home, framework, env, execute });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function registerCliTests(test) {
  test("CLI help succeeds without executing commands or creating files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "niral-cli-"));
    try {
      for (const args of [[], ["help"], ["--help"], ["-h"], ["create", "app", "--help"], ["restore", "latest", "-h"], ["add", "--help"]]) {
        const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /create <name>/);
        assert.match(result.stdout, /add <api\|/);
      }
      assert.deepEqual(readdirSync(cwd), []);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("CLI version reads the framework manifest and unknown commands fail", () => {
    const { version, bin } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.deepEqual(bin, { niral: "./bin/niral.js" });
    for (const alias of ["--version", "-v", "version"]) {
      const result = spawnSync(process.execPath, [cli, alias], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), `niral ${version}`);
    }
    const result = spawnSync(process.execPath, [cli, "not-a-command"], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown command/);
  });

  test("npm entry points handle help, version and invalid arguments without downloading", () => {
    for (const name of packages) withInstallation(({ home, execute }) => {
      for (const entry of ["niral", "create-niral"]) {
        for (const alias of ["--help", "-h", "--version", "-v"]) {
          const result = execute(installer(name, `bin/${entry}.js`), [alias]);
          assert.equal(result.status, 0, result.stderr);
        }
      }
      for (const args of [[], ["app", "--template"], ["app", "--template", "wrong"], ["app", "--unknown"], ["app", "another"]]) {
        assert.equal(execute(installer(name, "bin/create-niral.js"), args).status, 1);
      }
      assert.equal(execute(installer(name, "bin/niral.js"), ["update", "unexpected"]).status, 1);
      assert.equal(execute(installer(name, "bin/niral.js"), ["update", "--help"]).status, 0);
      assert.equal(existsSync(home), false);
    });
  });

  test("npm launchers forward cached commands and propagate child failures", () => {
    for (const name of packages) withInstallation(({ framework, root, execute }) => {
      writeFramework(framework);
      for (const args of [["dev", "project path", "-p", "6000"], ["add", "api", "."], ["check"], ["build"], ["test"]]) {
        const result = execute(installer(name, "bin/niral.js"), args);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout).args, args);
      }
      assert.equal(execute(installer(name, "bin/niral.js"), ["check"], { FIXTURE_EXIT: "7" }).status, 7);
      const failed = execute(installer(name, "bin/create-niral.js"), ["myapp"], { FIXTURE_EXIT: "6" });
      assert.equal(failed.status, 6);
      assert.equal(existsSync(join(root, ".zshrc")), false);
      assert.equal(existsSync(join(root, "calls")), false);
    });
  });

  test("create-niral forwards templates and installs an idempotent custom-home launcher", () => {
    for (const name of packages) withInstallation(({ framework, home, root, env, execute }) => {
      writeFramework(framework);
      for (const template of ["minimal", "blog", "dashboard"]) {
        const result = execute(installer(name, "bin/create-niral.js"), ["myapp", "--template", template]);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout.split("\n")[0]).args, ["create", "myapp", "--template", template]);
      }
      const profile = readFileSync(join(root, ".zshrc"), "utf8");
      assert.equal(profile.split("export PATH=").length, 2);
      if (process.platform !== "win32") {
        const result = spawnSync("/bin/sh", [join(home, "bin", "niral"), "dev", "project path"], { env: { ...env, NIRAL_HOME: "incorrect" }, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), { args: ["dev", "project path"], home });
      }
      assert.equal(existsSync(join(root, "calls")), false);
    });
  });

  test("updates reject dirty, non-main, custom-origin and failing Git installs without replacement", () => {
    for (const name of packages) for (const scenario of ["dirty", "branch", "origin", "pull-failure", "no-git"]) withInstallation(({ framework, home, root, execute }) => {
      writeFramework(framework);
      mkdirSync(join(framework, ".git"));
      writeFileSync(join(framework, "private-data"), "preserve");
      const result = execute(installer(name, "bin/niral.js"), ["update"], { FIXTURE_SCENARIO: scenario });
      assert.equal(result.status, 1, result.stdout);
      assert.equal(readFileSync(join(framework, "private-data"), "utf8"), "preserve");
      assert.equal(readFileSync(join(framework, "bin", "niral.js"), "utf8"), fixtureCli);
      assert.equal(existsSync(join(framework, "updated")), false);
      assert.equal(readFileSync(join(root, "calls"), "utf8").includes("download"), false);
      assert.deepEqual(readdirSync(home), ["framework"]);
    });
  });

  test("explicit updates reach the installer even when the cached CLI has no update command", () => {
    for (const name of packages) withInstallation(({ framework, root, execute }) => {
      writeFramework(framework, "throw new Error('old CLI must not run');");
      mkdirSync(join(framework, ".git"));
      const result = execute(installer(name, "bin/niral.js"), ["update"]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(join(framework, "updated"), "utf8"), "yes");
      const calls = readFileSync(join(root, "calls"), "utf8");
      assert.match(calls, /\["pull","--ff-only","origin","main"\]/);
    });
  });

  test("archive updates stage the new framework and retain the complete previous installation", () => {
    for (const name of packages) withInstallation(({ framework, home, root, env, execute }) => {
      writeFramework(framework);
      writeFileSync(join(framework, "private-data"), "preserve");
      writeFramework(env.FIXTURE_DOWNLOAD, "console.log('new framework');");
      const archive = join(root, "fixture.tgz");
      const packed = spawnSync("tar", ["-czf", archive, "-C", root, "download"], { encoding: "utf8" });
      assert.equal(packed.status, 0, packed.stderr);
      const result = execute(installer(name, "bin/niral.js"), ["update"], { FIXTURE_SCENARIO: "archive", FIXTURE_ARCHIVE: archive });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(join(framework, "bin", "niral.js"), "utf8"), "console.log('new framework');");
      const backup = readdirSync(home).find((entry) => entry.startsWith("framework-backup-"));
      assert.ok(backup);
      assert.equal(readFileSync(join(home, backup, "framework", "private-data"), "utf8"), "preserve");
      assert.equal(readdirSync(home).some((entry) => entry.startsWith(".")), false);
    });
  });

  test("failed downloads and invalid staged CLIs leave the installed framework intact", () => {
    for (const name of packages) for (const scenario of ["network-failure", "invalid-download"]) withInstallation(({ framework, home, env, execute }) => {
      writeFramework(framework);
      writeFramework(env.FIXTURE_DOWNLOAD, "invalid syntax !!!");
      const result = execute(installer(name, "bin/niral.js"), ["update"], { FIXTURE_SCENARIO: scenario });
      assert.equal(result.status, 1, result.stdout);
      assert.equal(readFileSync(join(framework, "bin", "niral.js"), "utf8"), fixtureCli);
      assert.deepEqual(readdirSync(home), ["framework"]);
    });
  });

  test("updates refuse concurrent installs, symlinks and unmanaged source checkouts", () => {
    for (const name of packages) withInstallation(({ framework, home, root, execute }) => {
      mkdirSync(join(home, ".framework-install-lock"), { recursive: true });
      const locked = execute(installer(name, "bin/niral.js"), ["update"]);
      assert.equal(locked.status, 1);
      assert.match(locked.stderr, /locked/);
      assert.equal(existsSync(join(home, ".framework-install-lock")), true);
      rmSync(join(home, ".framework-install-lock"), { recursive: true });
      const unmanaged = execute(cli, ["update"]);
      assert.equal(unmanaged.status, 1);
      assert.match(unmanaged.stderr, /only updates the managed/);
      if (process.platform !== "win32") {
        symlinkSync(root, framework);
        const linked = execute(installer(name, "bin/niral.js"), ["update"]);
        assert.equal(linked.status, 1);
        assert.match(linked.stderr, /real directory/);
      }
      assert.equal(existsSync(join(root, "calls")), false);
    });
  });

  test("npm packages carry identical launcher implementations", () => {
    for (const file of ["index.js", "bin/niral.js", "bin/create-niral.js"]) {
      assert.equal(readFileSync(installer("niral", file), "utf8"), readFileSync(installer("create-niral", file), "utf8"), file);
    }
    for (const name of packages) {
      const manifest = JSON.parse(readFileSync(installer(name, "package.json"), "utf8"));
      assert.deepEqual(manifest.dependencies, {});
      assert.deepEqual(manifest.files, ["bin/", "index.js", "README.md"]);
      assert.ok(readFileSync(installer(name, "README.md"), "utf8").includes("npx niral@latest update"));
    }
  });

  test("framework pins persist, reject implicit switches and preserve failed updates", () => {
    const ref = "a".repeat(40);
    for (const name of packages) withInstallation(({ framework, home, env, execute }) => {
      writeFramework(env.FIXTURE_DOWNLOAD);
      const entry = installer(name, "bin/niral.js");
      const installed = execute(entry, ["update"], { NIRAL_REF: ref, FIXTURE_REVISION: ref });
      assert.equal(installed.status, 0, installed.stderr);
      assert.equal(readFileSync(join(home, ".framework-ref"), "utf8").trim(), ref);
      mkdirSync(join(framework, ".git"));
      assert.equal(execute(entry, ["check"], { NIRAL_REF: "main" }).status, 1);
      const updated = execute(entry, ["update"], { FIXTURE_SCENARIO: "pinned", FIXTURE_REVISION: ref });
      assert.equal(updated.status, 0, updated.stderr);
      const failed = execute(entry, ["update"], { NIRAL_REF: "v9.9.9", FIXTURE_SCENARIO: "checkout-failure" });
      assert.equal(failed.status, 1);
      assert.equal(readFileSync(join(home, ".framework-ref"), "utf8").trim(), ref);
      assert.equal(readFileSync(join(framework, "bin", "niral.js"), "utf8"), fixtureCli);
      assert.equal(execute(entry, ["update"], { NIRAL_REF: "../../invalid" }).status, 1);
      const unpinned = execute(entry, ["update"], { NIRAL_REF: "main" });
      assert.equal(unpinned.status, 0, unpinned.stderr);
      assert.equal(existsSync(join(home, ".framework-ref")), false);
    });
  });

  test("archive framework pins use the requested commit URL", () => {
    const ref = "b".repeat(40);
    for (const name of packages) withInstallation(({ home, root, env, execute }) => {
      writeFramework(env.FIXTURE_DOWNLOAD);
      const archive = join(root, "fixture.tgz");
      assert.equal(spawnSync("tar", ["-czf", archive, "-C", root, "download"]).status, 0);
      const result = execute(installer(name, "bin/niral.js"), ["update"], { NIRAL_REF: ref, FIXTURE_SCENARIO: "archive", FIXTURE_ARCHIVE: archive });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(readFileSync(join(root, "calls"), "utf8").includes(`/tar.gz/${ref}`));
      assert.equal(readFileSync(join(home, ".framework-ref"), "utf8").trim(), ref);
    });
  });

  test("shell installer shares safe updates, quoting and backup preservation", () => {
    const shell = fileURLToPath(new URL("../install.sh", import.meta.url));
    assert.equal(readFileSync(shell, "utf8"), readFileSync(new URL("../apps/docs/install.sh", import.meta.url), "utf8"));
    if (process.platform === "win32") return;
    for (const scenario of ["archive", "network-failure", "dirty"]) withInstallation(({ root, home, framework, env }) => {
      writeFramework(framework);
      writeFileSync(join(framework, "private-data"), "preserve");
      if (scenario === "dirty") mkdirSync(join(framework, ".git"));
      writeFramework(env.FIXTURE_DOWNLOAD);
      const archive = join(root, "fixture.tgz");
      assert.equal(spawnSync("tar", ["-czf", archive, "-C", root, "download"]).status, 0);
      const bin = join(root, "fake-bin");
      mkdirSync(bin);
      writeFileSync(join(bin, "curl"), `#!${process.execPath}\nconst fs = require("node:fs"); const args = process.argv.slice(2); fs.copyFileSync(process.env.FIXTURE_BOOTSTRAP, args[args.indexOf("-o") + 1]);\n`, { mode: 0o755 });
      const shellEnv = {
        ...env, PATH: `${bin}:${process.env.PATH}`, NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(offlineLoader)}`,
        FIXTURE_BOOTSTRAP: installer("niral", "index.js"), FIXTURE_SCENARIO: scenario, FIXTURE_ARCHIVE: archive,
      };
      const result = spawnSync("bash", [shell], { cwd: root, encoding: "utf8", timeout: 15000, env: { ...shellEnv, NIRAL_REF: scenario === "archive" ? "c".repeat(40) : "main" } });
      assert.equal(result.status, scenario === "archive" ? 0 : 1, result.stderr);
      if (scenario === "archive") {
        const backup = readdirSync(home).find(entry => entry.startsWith("framework-backup-"));
        assert.equal(readFileSync(join(home, backup, "framework", "private-data"), "utf8"), "preserve");
        assert.ok(readFileSync(join(root, ".zshrc"), "utf8").includes("custom"));
        writeFileSync(join(framework, "bin", "niral.js"), "throw new Error('old CLI must not handle update');");
        const updated = spawnSync("sh", [join(home, "bin", "niral"), "update"], { encoding: "utf8", timeout: 15000, env: shellEnv });
        assert.equal(updated.status, 0, updated.stderr);
        assert.equal(readFileSync(join(home, ".framework-ref"), "utf8").trim(), "c".repeat(40));
        assert.equal(readFileSync(join(framework, "bin", "niral.js"), "utf8"), fixtureCli);
      } else {
        assert.equal(readFileSync(join(framework, "private-data"), "utf8"), "preserve");
        assert.equal(existsSync(join(root, ".zshrc")), false);
      }
    });
  });

  test("CLI documentation covers every dispatcher command and add recipe", () => {
    const source = readFileSync(cli, "utf8");
    const content = readFileSync(new URL("../apps/docs/lib/content.js", import.meta.url), "utf8");
    const reference = content.slice(content.indexOf("  cli: {"), content.indexOf("  benchmarks: {"));
    for (const [, command] of source.matchAll(/cmd === "([a-z-]+)"/g)) {
      assert.ok(reference.includes(`niral ${command}`), `missing command documentation: ${command}`);
    }
    for (const [, recipe] of source.matchAll(/what === "([a-z-]+)"/g)) {
      assert.ok(reference.includes("\\`" + recipe), `missing recipe documentation: ${recipe}`);
    }
  });

  test("fresh launcher installs validate the staged framework before forwarding", () => {
    for (const name of packages) withInstallation(({ home, framework, env, execute }) => {
      writeFramework(env.FIXTURE_DOWNLOAD);
      const result = execute(installer(name, "bin/niral.js"), ["dev", "project path"]);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout.trim().split("\n").at(-1)).args, ["dev", "project path"]);
      assert.equal(existsSync(join(framework, "bin", "niral.js")), true);
      assert.deepEqual(readdirSync(home), ["framework"]);
    });
  });

  test("installed framework update routes through its own managed installation", () => {
    withInstallation(({ framework, execute }) => {
      writeFramework(framework, readFileSync(cli, "utf8"));
      cpSync(new URL("../src/", import.meta.url), join(framework, "src"), { recursive: true });
      cpSync(new URL("../installer/create-niral/", import.meta.url), join(framework, "installer", "create-niral"), { recursive: true });
      mkdirSync(join(framework, ".git"));
      const result = execute(join(framework, "bin", "niral.js"), ["update"]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(join(framework, "updated"), "utf8"), "yes");
    });
  });

  test("both npm scaffolders create real templates and refuse existing projects", () => {
    if (process.platform === "win32") return;
    for (const name of packages) withInstallation(({ home, framework, root, execute }) => {
      mkdirSync(home, { recursive: true });
      symlinkSync(fileURLToPath(new URL("../", import.meta.url)), framework);
      for (const template of ["minimal", "blog", "dashboard"]) {
        const app = `app-${template}`;
        const result = execute(installer(name, "bin/create-niral.js"), [app, "--template", template]);
        assert.equal(result.status, 0, result.stderr);
        assert.ok(existsSync(join(root, app, "routes", "index.niral")));
        assert.ok(existsSync(join(root, app, "AGENTS.md")));
        const original = readFileSync(join(root, app, "routes", "index.niral"), "utf8");
        const repeat = execute(installer(name, "bin/create-niral.js"), [app]);
        assert.equal(repeat.status, 1);
        assert.equal(readFileSync(join(root, app, "routes", "index.niral"), "utf8"), original);
      }
      assert.equal(existsSync(join(root, "calls")), false);
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tests = [];
  registerCliTests((name, run) => tests.push({ name, run }));
  let failures = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${name}\n${error.stack}`);
    }
  }
  console.log(`${tests.length - failures} passed, ${failures} failed`);
  process.exitCode = failures ? 1 : 0;
}