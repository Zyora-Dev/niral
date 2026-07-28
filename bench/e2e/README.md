# Niral end-to-end benchmark — vs Next.js & SvelteKit

The whole request path, not a micro-benchmark: each framework's **own
production server** (`niral start`, `next start`, SvelteKit adapter-node),
real HTTP, **dynamic SSR on every request** (no prerender, no cache), the same
1000-row page as `bench/hydration/`.

## Run it

```sh
npm install        # bench-only deps (next, sveltekit, autocannon) — the framework stays zero-dep
node run.js        # builds all three, boots each server, load-tests, prints the scoreboard
```

Tunables: `BENCH_DURATION` (default 10s) · `BENCH_CONNECTIONS` (default 100).

## Results (2026-07-28 · M-series MacBook Air, idle · Node 25 · two runs, representative)

| framework | req/s | p50 | p99 | cold start | build | RSS after load | page (identity) |
|-----------|------:|----:|----:|-----------:|------:|---------------:|----------------:|
| **niral** | **2,196–2,240** | **40 ms** | 114–182 ms | **145–169 ms** | **0.2 s** | **194–202 MB** | 125.3 KB |
| sveltekit 2 (svelte 5) | 570–586 | 127–129 ms | 1,590–1,661 ms | 156–158 ms | 2.3–3.7 s | 291–355 MB | 82.4 KB |
| next 16 (react 19) | 278–298 | 310–311 ms | 2,274–3,180 ms | 345–351 ms | 3.3–5.5 s | 443–456 MB | 121.3 KB |

Zero errors / non-2xx for every framework in every run.

- **~3.8× SvelteKit and ~7.5× Next.js** on dynamic SSR throughput
- p50 latency under load: 40 ms vs 128 ms vs 310 ms
- p99 stays near 150 ms while the others exceed 1.5–3 s
- production build: 0.2 s vs seconds — build dirs wiped before each timed build

## What is measured

1. **build** — cold production build (output dirs removed first)
2. **cold start** — process spawn → first 200 response
3. **throughput/latency** — autocannon, 100 connections × 10 s, after a 2 s warmup
4. **RSS** — the server's process tree, sampled right after the load test
5. **page size** — identity and gzip transfer sizes

Every page is sanity-checked to contain all 1000 rows before the load test.

## Fairness notes

- All three render **the same data-loaded page per request**: niral `load()`,
  Next `dynamic = "force-dynamic"` (App Router, RSC), SvelteKit `+page.server.js`
  (dynamic by default). No caching layers anywhere.
- Each framework runs its own shipped production server, single process,
  default settings — exactly what `npx next start` / adapter-node / `niral start`
  give a user.
- The load test sends no `accept-encoding`, so all three serve identity bytes —
  SvelteKit's adapter-node ships no compression (they recommend a reverse
  proxy), while niral and Next compress built-in; excluding compression keeps
  the comparison about rendering, not gzip.
- Page sizes differ because each framework inlines its own hydration payload;
  SvelteKit's is the smallest here — and niral still leads throughput while
  writing ~50% more bytes per response.
- Numbers vary with hardware and load. The bench is deliberately reproducible —
  run it yourself.
