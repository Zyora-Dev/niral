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

## Results (2026-07-29 · M-series MacBook Air, idle · Node 25 · representative run)

Five frameworks, identical 1000-row dynamic-SSR page, 100 connections × 10s:

| framework | req/s | p50 | p99 | cold start | build | RSS after load |
|-----------|------:|----:|----:|-----------:|------:|---------------:|
| **niral** | **2,374** | **39 ms** | **81 ms** | 138 ms | **0.2 s** | 210 MB |
| solidstart 1 (solid-js) | 1,885 | 43 ms | 151 ms | 154 ms | 4.9 s | 508 MB |
| astro 5 (node adapter) | 698 | 140 ms | 338 ms | 211 ms | 1.3 s | 295 MB |
| sveltekit 2 (svelte 5) | 599 | 137 ms | 1,101 ms | 156 ms | 2.9 s | 262 MB |
| next 16 (react 19) | 303 | 305 ms | 2,337 ms | 363 ms | 3.9 s | 494 MB |

Zero errors / non-2xx for every framework in every run.

- **niral is #1 on throughput** — ~1.3× SolidStart, ~3.4× Astro, ~4× SvelteKit, ~7.8× Next.js
- **Best tail latency by far** — p99 81 ms while every other framework exceeds 150 ms (and Next/Svelte exceed 1 s)
- **Lowest memory** — 210 MB vs SolidStart 508 MB, Next 494 MB
- **Fastest build** — 0.2 s (no bundler) vs 1.3–4.9 s
- SolidStart is the closest rival (fine-grained, like niral); niral still leads it on throughput, tail latency, memory and build

Honest note: Go/Rust and other compiled-language servers would out-throughput any
JS framework — that's expected. This bench compares niral against the JavaScript
meta-frameworks it actually competes with. Qwik was attempted but its node-server
adapter needs additional manifest wiring; not included here.

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
