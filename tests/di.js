import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createProvider } from "../src/di/provider.js";
import { runAgent } from "../src/di/agent.js";

const tool = {
  name: "inspect_route", description: "Inspect a named route without changing it.",
  parameters: { type: "object", properties: { route: { type: "string" } }, required: ["route"], additionalProperties: false },
};
const call = { id: "call_1", name: tool.name, arguments: { route: "/" } };
const chatCall = { id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } };
const fixtures = {
  "chat-completions": [
    { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, reasoning_content: "opaque-provider-state", tool_calls: [chatCall] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    { choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Route inspected." } }], usage: { prompt_tokens: 20, completion_tokens: 3 } },
  ],
  responses: [
    { status: "completed", output: [{ type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque-provider-state" }, { type: "function_call", id: "fc_1", call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments), status: "completed" }], usage: { input_tokens: 10, output_tokens: 5 } },
    { status: "completed", output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Route inspected." }] }], usage: { input_tokens: 20, output_tokens: 3 } },
  ],
  anthropic: [
    { role: "assistant", stop_reason: "tool_use", content: [{ type: "thinking", thinking: "opaque-provider-state", signature: "signed-state" }, { type: "tool_use", id: call.id, name: call.name, input: call.arguments }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7 } },
    { role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "Route inspected." }], usage: { input_tokens: 20, output_tokens: 3 } },
  ],
};

function mockProvider(protocol, replies = fixtures[protocol], config = {}) {
  const requests = [];
  const provider = createProvider({ protocol, model: "chosen-model", baseURL: "https://provider.example/v1", apiKey: "test-secret", ...config }, {
    fetchImpl: async (url, options) => {
      requests.push({ url, ...options, body: JSON.parse(options.body) });
      const reply = replies[requests.length - 1];
      assert.ok(reply, "unexpected extra provider request");
      return reply instanceof Response ? reply : Response.json(reply);
    },
  });
  return { provider, requests };
}

export function registerDiTests(test) {
  test("DI adapters preserve multiple call IDs and group Claude tool results", async () => {
    for (const protocol of Object.keys(fixtures)) {
      const replies = structuredClone(fixtures[protocol]);
      if (protocol === "chat-completions") replies[0].choices[0].message.tool_calls.push({ ...chatCall, id: "call_2" });
      else if (protocol === "responses") replies[0].output.push({ ...replies[0].output[1], id: "fc_2", call_id: "call_2" });
      else replies[0].content.push({ ...replies[0].content[1], id: "call_2" });
      const { provider, requests } = mockProvider(protocol, replies);
      const approved = [];
      const result = await runAgent({ provider, prompt: "inspect", tools: [{ ...tool, validate: () => true, execute: () => "ok" }], authorize: (requested) => { approved.push(requested.id); return true; } });
      assert.deepEqual(approved, ["call_1", "call_2"]);
      assert.equal(result.toolCalls, 2);
      if (protocol === "anthropic") assert.deepEqual(requests[1].body.messages.at(-1).content.map((block) => block.tool_use_id), approved);
      else if (protocol === "responses") assert.deepEqual(requests[1].body.input.slice(-2).map((item) => item.call_id), approved);
      else assert.deepEqual(requests[1].body.messages.slice(-2).map((item) => item.tool_call_id), approved);
    }
  });

  test("DI adapters expose refusals and reject protocol mismatches", async () => {
    const refusals = {
      "chat-completions": { choices: [{ finish_reason: "stop", message: { role: "assistant", content: null, refusal: "Cannot help." } }] },
      responses: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "Cannot help." }] }] },
      anthropic: { role: "assistant", stop_reason: "refusal", content: [{ type: "text", text: "Cannot help." }] },
    };
    for (const [protocol, reply] of Object.entries(refusals)) {
      const result = await runAgent({ provider: mockProvider(protocol, [reply]).provider, prompt: "inspect" });
      assert.equal(result.refused, true);
      assert.equal(result.toolCalls, 0);
      assert.equal(result.text, "Cannot help.");
    }
    const first = await mockProvider("responses").provider.complete({ messages: [] });
    await assert.rejects(mockProvider("anthropic").provider.complete({ messages: [first] }), /different provider protocol/);
  });

  test("DI network timeout, cancellation, broken streams and JSON errors are bounded and redacted", async () => {
    const config = { protocol: "chat-completions", baseURL: "https://provider.example/v1", model: "chosen-model", apiKey: "test-secret", timeoutMs: 10 };
    const request = { messages: [{ role: "user", content: "inspect" }] };
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      const timed = createProvider(config, { fetchImpl: async (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })) });
      await assert.rejects(timed.complete(request), /timed out/);
      const aborted = new AbortController();
      const cancelled = createProvider(config, { fetchImpl: async () => { aborted.abort(); throw new Error("test-secret"); } });
      await assert.rejects(cancelled.complete({ ...request, signal: aborted.signal }), { name: "AbortError" });
      const network = createProvider(config, { fetchImpl: async () => { throw new Error("test-secret"); } });
      await assert.rejects(network.complete(request), (error) => /connection failed/.test(error.message) && !error.message.includes("test-secret"));
      const broken = new Response(new ReadableStream({ start(controller) { controller.error(new Error("test-secret")); } }));
      await assert.rejects(mockProvider("chat-completions", [broken]).provider.complete(request), /malformed/);
      await assert.rejects(mockProvider("chat-completions", [new Response("test-secret")]).provider.complete(request), /malformed/);
    } finally { clearTimeout(keepAlive); }
  });

  for (const protocol of Object.keys(fixtures)) {
    test(`DI ${protocol}: shared agent validates, approves and executes tools`, async () => {
      const { provider } = mockProvider(protocol);
      const executed = [];
      const result = await runAgent({
        provider, prompt: "Inspect the home route.",
        tools: [{ ...tool, validate: (args) => args.route === "/", execute: (args) => { executed.push(args); return { route: "/" }; } }],
        authorize: (requested) => requested.name === tool.name,
      });
      assert.equal(result.text, "Route inspected.");
      assert.equal(result.turns, 2);
      assert.equal(result.toolCalls, 1);
      assert.deepEqual(executed, [{ route: "/" }]);
      assert.deepEqual(result.usage.map((usage) => usage.inputTokens), [10, 20]);
    });
  }

  test("DI agent defaults to denial and does not expose tool exceptions", async () => {
    let executed = 0;
    const tools = [{ ...tool, validate: () => true, execute: () => { executed++; throw new Error("private-file-content"); } }];
    const denied = await runAgent({ provider: mockProvider("anthropic").provider, prompt: "inspect", tools });
    assert.equal(executed, 0);
    assert.equal(denied.messages[2].isError, true);
    assert.match(denied.messages[2].content, /denied/);
    const failed = await runAgent({ provider: mockProvider("anthropic").provider, prompt: "inspect", tools, authorize: () => true });
    assert.equal(executed, 1);
    assert.equal(failed.messages[2].isError, true);
    assert.ok(!JSON.stringify(failed).includes("private-file-content"));
  });

  test("DI agent preflights the entire batch before executing any tool", async () => {
    let executed = 0;
    const tools = [{ ...tool, validate: (args) => args.route === "/", execute: () => executed++ }];
    const options = { prompt: "inspect", tools, authorize: () => true };
    for (const badCall of [{ ...call, id: "call_2", name: "unknown" }, { ...call, id: "call_2", arguments: { route: 12 } }, call]) {
      const provider = { complete: async () => ({ role: "assistant", content: "", toolCalls: [call, badCall] }) };
      await assert.rejects(runAgent({ ...options, provider }), /DI:/);
      assert.equal(executed, 0);
    }
    await assert.rejects(runAgent({ ...options, provider: mockProvider("chat-completions").provider, tools: [{ ...tool, execute: () => executed++ }] }), /validator/);
    await assert.rejects(runAgent({ ...options, provider: mockProvider("chat-completions").provider, tools: [{ ...tools[0], validate: () => "yes" }] }), /invalid tool arguments/);
    assert.equal(executed, 0);
  });

  test("DI agent enforces turn, call, repeated-ID and result limits", async () => {
    let executed = 0;
    const tools = [{ ...tool, validate: () => true, execute: () => { executed++; return "a long tool result"; } }];
    const options = { prompt: "inspect", tools, authorize: () => true };
    await assert.rejects(runAgent({ ...options, provider: mockProvider("chat-completions").provider, maxTurns: 1 }), /turn limit/);
    assert.equal(executed, 0);
    const twoCalls = { complete: async () => ({ role: "assistant", content: "", toolCalls: [call, { ...call, id: "call_2" }] }) };
    await assert.rejects(runAgent({ ...options, provider: twoCalls, maxToolCalls: 1 }), /call limit/);
    assert.equal(executed, 0);
    const repeated = { complete: async () => ({ role: "assistant", content: "", toolCalls: [call] }) };
    await assert.rejects(runAgent({ ...options, provider: repeated }), /repeated tool call/);
    assert.equal(executed, 1);
    await assert.rejects(runAgent({ ...options, provider: mockProvider("chat-completions").provider, maxToolResultBytes: 5 }), /result exceeded/);
    assert.equal(executed, 2);
  });

  test("DI agent cancellation and deadlines stop subsequent execution", async () => {
    let executed = 0;
    const controller = new AbortController();
    const tools = [{ ...tool, validate: () => true, execute: () => executed++ }];
    await assert.rejects(runAgent({ provider: mockProvider("chat-completions").provider, prompt: "inspect", tools, signal: controller.signal, authorize: () => { controller.abort(); return true; } }), { name: "AbortError" });
    assert.equal(executed, 0);
    await assert.rejects(runAgent({ provider: { complete: () => new Promise(() => {}) }, prompt: "inspect", timeoutMs: 10 }), { name: "TimeoutError" });
    await assert.rejects(runAgent({ provider: mockProvider("chat-completions").provider, prompt: "inspect", tools, authorize: () => new Promise(() => {}), timeoutMs: 10 }), { name: "TimeoutError" });
    assert.equal(executed, 0);
  });

  for (const protocol of Object.keys(fixtures)) {
    test(`DI ${protocol}: tool round-trip preserves wire history and usage`, async () => {
      const { provider, requests } = mockProvider(protocol);
      const messages = [{ role: "user", content: "Inspect the home route." }];
      const first = await provider.complete({ system: "Niral DI", messages, tools: [tool] });
      assert.deepEqual(first.toolCalls, [call]);
      assert.equal(first.usage.inputTokens, 10);
      messages.push(first, { role: "tool", callId: call.id, content: "Home route found.", isError: false });
      const final = await provider.complete({ system: "Niral DI", messages, tools: [tool] });
      assert.equal(final.content, "Route inspected.");
      assert.equal(final.usage.outputTokens, 3);
      assert.equal(requests[0].body.model, "chosen-model");
      assert.equal(requests[0].redirect, "error");
      assert.ok(!JSON.stringify(requests[0].body).includes("test-secret"));
      assert.ok(JSON.stringify(requests[1].body).includes("opaque-provider-state"));
      if (protocol === "chat-completions") {
        assert.equal(requests[0].url, "https://provider.example/v1/chat/completions");
        assert.deepEqual(requests[0].body.tools[0].function.parameters, tool.parameters);
        assert.deepEqual(requests[1].body.messages.at(-1), { role: "tool", tool_call_id: call.id, content: "Home route found." });
      } else if (protocol === "responses") {
        assert.equal(requests[0].url, "https://provider.example/v1/responses");
        assert.equal(requests[0].body.store, false);
        assert.deepEqual(requests[0].body.include, ["reasoning.encrypted_content"]);
        assert.deepEqual(requests[1].body.input.at(-1), { type: "function_call_output", call_id: call.id, output: "Home route found." });
      } else {
        assert.equal(requests[0].url, "https://provider.example/v1/messages");
        assert.equal(requests[0].headers["x-api-key"], "test-secret");
        assert.equal(requests[0].headers["anthropic-version"], "2023-06-01");
        assert.deepEqual(requests[1].body.messages.at(-1), { role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content: "Home route found.", is_error: false }] });
      }
    });
  }

  test("DI Azure and custom endpoints: explicit auth, deployment model and API version", async () => {
    for (const protocol of ["chat-completions", "responses"]) {
      const { provider, requests } = mockProvider(protocol, undefined, { baseURL: "https://resource.openai.azure.com/openai/v1/", auth: "api-key", apiVersion: "preview", model: "my-deployment" });
      await provider.complete({ messages: [{ role: "user", content: "hello" }] });
      assert.equal(requests[0].headers["api-key"], "test-secret");
      assert.equal(requests[0].headers.authorization, undefined);
      assert.equal(requests[0].body.model, "my-deployment");
      assert.equal(requests[0].url, `https://resource.openai.azure.com/openai/v1/${protocol === "responses" ? "responses" : "chat/completions"}?api-version=preview`);
    }
    let token = 0;
    const { provider, requests } = mockProvider("chat-completions", undefined, { getCredential: () => `token-${++token}` });
    await provider.complete({ messages: [{ role: "user", content: "hello" }] });
    await provider.complete({ messages: [{ role: "user", content: "hello again" }] });
    assert.equal(requests[0].headers.authorization, "Bearer token-1");
    assert.equal(requests[1].headers.authorization, "Bearer token-2");
    const local = mockProvider("chat-completions", undefined, { baseURL: "http://127.0.0.1:11434/v1", auth: "none" });
    await local.provider.complete({ messages: [{ role: "user", content: "hello" }] });
    assert.equal(local.requests[0].headers.authorization, undefined);
  });

  test("DI adapters reject unsafe configuration, malformed calls and incomplete output", async () => {
    for (const config of [{ baseURL: "http://remote.example/v1" }, { baseURL: "https://user:secret@provider.example/v1" }, { baseURL: "https://provider.example/v1?key=secret" }, { protocol: "unknown" }, { model: "" }, { auth: "unknown" }, { timeoutMs: 0 }]) {
      assert.throws(() => mockProvider("chat-completions", undefined, config), /DI:/);
    }
    const invalid = [
      { choices: [{ finish_reason: "length", message: { role: "assistant", content: "partial", tool_calls: [chatCall] } }] },
      { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", tool_calls: [{ ...chatCall, function: { name: call.name, arguments: "{" } }] } }] },
      { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", tool_calls: [chatCall, chatCall] } }] },
      { choices: [{ finish_reason: "tool_calls", message: { role: "assistant", tool_calls: [{ ...chatCall, function: { name: call.name, arguments: "[]" } }] } }] },
    ];
    for (const reply of invalid) await assert.rejects(mockProvider("chat-completions", [reply]).provider.complete({ messages: [] }), /malformed/);
    for (const args of [null, [], {}, 42]) {
      const reply = structuredClone(fixtures["chat-completions"][0]);
      reply.choices[0].message.tool_calls[0].function.arguments = args;
      await assert.rejects(mockProvider("chat-completions", [reply]).provider.complete({ messages: [] }), /malformed/);
    }
    await assert.rejects(mockProvider("responses", [{ ...fixtures.responses[0], status: "incomplete" }]).provider.complete({ messages: [] }), /malformed/);
    await assert.rejects(mockProvider("anthropic", [{ ...fixtures.anthropic[0], stop_reason: "max_tokens" }]).provider.complete({ messages: [] }), /malformed/);
  });

  test("DI transport bounds payloads and keeps remote errors and credentials private", async () => {
    const request = { messages: [{ role: "user", content: "hello" }] };
    const failed = mockProvider("chat-completions", [new Response("test-secret", { status: 401 })]);
    await assert.rejects(failed.provider.complete(request), (error) => /HTTP 401/.test(error.message) && !error.message.includes("test-secret"));
    const large = mockProvider("chat-completions", undefined, { maxRequestBytes: 5 });
    await assert.rejects(large.provider.complete(request), /request exceeded/);
    assert.equal(large.requests.length, 0);
    await assert.rejects(mockProvider("chat-completions", undefined, { maxResponseBytes: 5 }).provider.complete(request), /response exceeded/);
    const cancelled = mockProvider("chat-completions");
    await assert.rejects(cancelled.provider.complete({ ...request, signal: AbortSignal.abort() }), { name: "AbortError" });
    assert.equal(cancelled.requests.length, 0);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const queue = [];
  registerDiTests((name, run) => queue.push({ name, run }));
  for (const { name, run } of queue) {
    await run();
    console.log(`PASS ${name}`);
  }
  console.log(`${queue.length} DI tests passed`);
}