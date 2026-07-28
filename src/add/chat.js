/**
 * niral add chat — a streaming AI chat page, scaffolded INTO the project.
 *
 * One file demonstrates the whole AI story: the <server> block streams tokens
 * from `ai.stream()` (any OpenAI-compatible endpoint via NIRAL_AI_URL), the
 * client consumes the streaming RPC with `for await`, and the UI renders
 * tokens as they arrive. The user owns the file — restyle, extend, add RAG.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const CHAT_PAGE = `<server>
// Streams straight from your model — set NIRAL_AI_URL (+ NIRAL_AI_KEY, NIRAL_AI_MODEL).
// Works with OpenAI, Azure, Ollama, vLLM, llama.cpp — anything OpenAI-compatible.
export async function* ask(messages) {
  for await (const chunk of ai.stream(messages, { system: "You are a concise, helpful assistant." })) {
    yield chunk
  }
}
</server>

<script>
  let messages = $state([])   // { role: "user" | "assistant", content }
  let draft = $state("")
  let busy = $state(false)

  async function send() {
    const text = draft.trim()
    if (!text || busy) return
    draft = ""
    busy = true
    messages = [...messages, { role: "user", content: text }, { role: "assistant", content: "" }]
    const grow = (delta) => {
      // NEW object for the last row — keyed rows update by reference
      messages = messages.map((m, idx) =>
        idx === messages.length - 1 ? { ...m, content: delta(m.content) } : m)
    }
    try {
      const stream = await ask(messages.slice(0, -1))
      for await (const chunk of stream) {
        grow((prev) => prev + chunk)
      }
    } catch (e) {
      grow(() => "⚠ " + e.message)
    }
    busy = false
  }
</script>

<head>
  <title>Chat</title>
</head>

<div class="chat">
  <div class="log">
    {#for m, i of messages key i}
      <div class={m.role === "user" ? "msg user" : "msg bot"}>{m.content}</div>
    {/for}
    {#if messages.length === 0}
      <p class="empty">Ask anything — replies stream in live.</p>
    {/if}
  </div>
  <form on:submit={(e) => { e.preventDefault(); send() }}>
    <input bind:value={draft} placeholder="Type a message…" autocomplete="off" />
    <button disabled={busy}>{busy ? "…" : "Send"}</button>
  </form>
</div>

<style>
  .chat { max-width: 640px; margin: 2rem auto; display: flex; flex-direction: column; gap: 1rem; font-family: system-ui, sans-serif; }
  .log { display: flex; flex-direction: column; gap: .5rem; min-height: 40vh; }
  .msg { padding: .6rem .9rem; border-radius: 12px; white-space: pre-wrap; line-height: 1.5; max-width: 85%; }
  .user { align-self: flex-end; background: #2563eb; color: #fff; }
  .bot { align-self: flex-start; background: #f1f5f9; color: #0f172a; }
  .empty { color: #94a3b8; text-align: center; margin-top: 3rem; }
  form { display: flex; gap: .5rem; }
  input { flex: 1; padding: .65rem .9rem; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 1rem; }
  button { padding: .65rem 1.2rem; border: 0; border-radius: 10px; background: #0f172a; color: #fff; font-size: 1rem; cursor: pointer; }
  button:disabled { opacity: .5; }
</style>
`;

export async function addChat({ root }) {
  const dir = resolve(root);
  const dest = join(dir, "routes", "chat.niral");
  mkdirSync(join(dir, "routes"), { recursive: true });
  if (existsSync(dest)) {
    console.log("niral · routes/chat.niral already exists — leaving it alone");
    return dest;
  }
  writeFileSync(dest, CHAT_PAGE);
  console.log("niral · streaming AI chat ready — routes/chat.niral");
  console.log("niral · set NIRAL_AI_URL (e.g. http://localhost:11434/v1 for Ollama) + NIRAL_AI_MODEL, then open /chat");
  return dest;
}
