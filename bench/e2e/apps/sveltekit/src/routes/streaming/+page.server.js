const DELAY = Number(process.env.BENCH_DELAY ?? 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// STREAMING: return the slow work as a top-level PROMISE (not awaited).
// SvelteKit streams it to the client and resolves the {#await} on settle.
export function load() {
  return { slow: sleep(DELAY).then(() => 1000) };
}
