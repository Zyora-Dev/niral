import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync, symlinkSync, linkSync, chmodSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { runDi } from "../src/di/cli.js";
import { createWorkspaceTools } from "../src/di/workspace.js";

async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "niral-di-cli-"));
  const env = { NIRAL_HOME: join(root, "home"), DI_TEST_KEY: "not-a-real-secret" };
  let text = "";
  const output = { write: (value) => { text += value; } };
  const setup = ["setup", "--protocol", "responses", "--base-url", "https://provider.example/v1", "--model", "exact-deployment", "--auth", "api-key", "--key-env", "DI_TEST_KEY", "--api-version", "chosen-version"];
  try { await run({ root, env, output, text: () => text, setup }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

export function registerDiCliTests(test) {
  test("DI workspace tools reject private paths, escapes, symlinks and stale edits", async () => {
    await fixture(async ({ root, env }) => {
      const tools = createWorkspaceTools({ root, home: env.NIRAL_HOME });
      const read = tools.find((tool) => tool.name === "read_file");
      const write = tools.find((tool) => tool.name === "write_file");
      for (const path of ["../outside.js", "/etc/passwd", ".env", ".hidden folder/config.js", "data/app.json", ".git/config", "credentials.json", "home/di.json", "dir/../../outside.js", "dir\\outside.js", "key.pem"]) assert.equal(read.validate({ path }), false, path);
      assert.equal(read.validate({ path: "index.js", extra: true }), false);
      writeFileSync(join(root, "index.js"), "original");
      chmodSync(join(root, "index.js"), 0o664);
      const original = read.execute({ path: "index.js" });
      assert.equal(write.validate({ path: "index.js", content: "no", expectedHash: [original.hash] }), false);
      const result = write.execute({ path: "index.js", content: "changed", expectedHash: original.hash });
      assert.equal(statSync(join(root, "index.js")).mode & 0o777, 0o664);
      assert.equal(readFileSync(join(root, "index.js"), "utf8"), "changed");
      assert.equal(JSON.parse(readFileSync(result.backup, "utf8")).original, "original");
      assert.throws(() => write.execute({ path: "index.js", content: "stale", expectedHash: original.hash }), /changed/);
      assert.throws(() => write.execute({ path: "index.js", content: "overwrite", expectedHash: null }), /changed/);
      write.execute({ path: "routes/new.niral", content: "<h1>New</h1>", expectedHash: null });
      assert.equal(readFileSync(join(root, "routes/new.niral"), "utf8"), "<h1>New</h1>");
      symlinkSync(join(root, "index.js"), join(root, "alias.js"));
      assert.equal(read.validate({ path: "alias.js" }), false);
      linkSync(join(root, "index.js"), join(root, "hard.js"));
      assert.throws(() => read.execute({ path: "hard.js" }), /single-link/);
      const aborted = new AbortController(); aborted.abort();
      assert.throws(() => write.execute({ path: "aborted.js", content: "no", expectedHash: null }, { signal: aborted.signal }));
      assert.equal(existsSync(join(root, "aborted.js")), false);
      assert.deepEqual(createWorkspaceTools({ root, home: env.NIRAL_HOME, readOnly: true }).map((tool) => tool.name), ["list_files", "read_file"]);
    });
  });

  test("DI CLI executes approved workspace tools and denies noninteractive writes", async () => {
    await fixture(async ({ root, env, output, setup }) => {
      await runDi(setup, { env, output });
      await assert.rejects(runDi(["ask", "edit"], { env, output, input: {}, error: {} }), /interactive terminal/);
      const approvals = [];
      let requests = 0;
      const invoke = async (approved) => runDi(["ask", "create route", "--root", root], { env, output,
        question: async (message) => { approvals.push(message); return message.includes("Tool request") ? approved : "y"; },
        fetchImpl: async (url, options) => {
          const body = JSON.parse(options.body);
          requests++;
          if (body.input.length === 1) return Response.json({ status: "completed", output: [{ type: "function_call", call_id: "write-1", name: "write_file", arguments: JSON.stringify({ path: "index.niral", content: "<h1>DI</h1>", expectedHash: null }) }] });
          assert.ok(body.input.at(-1).output.includes(approved === "y" ? "written" : "denied"));
          return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] }] });
        },
      });
      assert.equal(await invoke("n"), 0);
      assert.equal(existsSync(join(root, "index.niral")), false);
      assert.equal(await invoke("y"), 0);
      assert.equal(readFileSync(join(root, "index.niral"), "utf8"), "<h1>DI</h1>");
      assert.equal(requests, 4);
      assert.ok(approvals.some((message) => message.includes("<h1>DI</h1>")));
    });
  });

  test("DI chat maintains bounded text context and clears it; new uses real scaffolding", async () => {
    await fixture(async ({ root, env, output, setup }) => {
      await runDi(setup, { env, output });
      const answers = ["first", "second", "/clear", "third", "/exit"];
      const prompts = [];
      const fetchImpl = async (url, options) => {
        prompts.push(JSON.parse(options.body).input[0].content);
        return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Response" }] }] });
      };
      assert.equal(await runDi(["chat", "--no-tools"], { env, output, question: async () => answers.shift(), fetchImpl }), 0);
      assert.ok(prompts[1].includes("first"));
      assert.equal(prompts[2], "third");
      assert.equal(await runDi(["new", "myapp", "build a page", "--template", "blog"], { cwd: root, env, output, question: async () => "y", fetchImpl }), 0);
      assert.ok(existsSync(join(root, "myapp", "AGENTS.md")));
      await assert.rejects(runDi(["new", "myapp", "overwrite"], { cwd: root, env, output, question: async () => "y", fetchImpl }), /not empty/);
      await assert.rejects(runDi(["new", "../escape", "build"], { cwd: root, env, output, question: async () => "y", fetchImpl }), /simple directory/);
    });
  });

  test("DI CLI setup stores exact settings without credentials; status stays offline", async () => {
    await fixture(async ({ root, env, output, text, setup }) => {
      await runDi(setup, { env, output });
      const stored = readFileSync(join(env.NIRAL_HOME, "di.json"), "utf8");
      assert.equal(JSON.parse(stored).model, "exact-deployment");
      assert.ok(!stored.includes(env.DI_TEST_KEY));
      await runDi(["status"], { env, output });
      assert.ok(!text().includes(env.DI_TEST_KEY));
      assert.ok(text().includes('"credentialAvailable": true'));
      await assert.rejects(runDi(setup, { env, output }), /already configured/);
      await assert.rejects(runDi(["setup", "--api-key", "secret"], { env, output }), /invalid setup/);
      await assert.rejects(runDi(["ask", "hello", "--no-tools"], { env: { NIRAL_HOME: env.NIRAL_HOME }, output }), /credential variable/);
      assert.ok(!existsSync(join(root, "routes")));
    });
  });

  test("DI CLI ask uses exact provider and never attaches workspace in prompt-only mode", async () => {
    await fixture(async ({ env, output, text, setup }) => {
      await runDi(setup, { env, output });
      let requests = 0;
      const exit = await runDi(["ask", "hello", "--no-tools"], { env, output, fetchImpl: async (url, options) => {
        requests++;
        assert.equal(String(url), "https://provider.example/v1/responses?api-version=chosen-version");
        const body = JSON.parse(options.body);
        assert.equal(body.model, "exact-deployment");
        assert.equal(body.input[0].content, "hello");
        assert.ok(!body.tools?.length);
        return Response.json({ status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello\u001b[31m." }] }] });
      } });
      assert.equal(exit, 0);
      assert.equal(requests, 1);
      assert.ok(text().endsWith("Hello.\n"));
    });
  });

  test("DI CLI help is routed through framework and both npm launchers", async () => {
    await fixture(async ({ root, env }) => {
      for (const entry of ["../bin/niral.js", "../installer/niral/bin/niral.js", "../installer/create-niral/bin/niral.js"]) {
        if (!existsSync(env.NIRAL_HOME)) {
          mkdirSync(env.NIRAL_HOME);
          symlinkSync(new URL("../", import.meta.url), join(env.NIRAL_HOME, "framework"), "dir");
        }
        const result = spawnSync(process.execPath, [new URL(entry, import.meta.url).pathname, "di", "--help"], { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Developer Intelligence/);
        assert.ok(!existsSync(join(env.NIRAL_HOME, "di.json")));
      }
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tests = [];
  registerDiCliTests((name, run) => tests.push({ name, run }));
  let failed = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
  }
  console.log(`${tests.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}