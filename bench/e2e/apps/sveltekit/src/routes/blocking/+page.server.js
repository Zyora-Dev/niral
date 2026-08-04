const DELAY = Number(process.env.BENCH_DELAY ?? 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// BLOCKING baseline: load awaits the slow work, so the response is gated on it.
export async function load() {
  await sleep(DELAY);
  return { total: 1000 };
}
