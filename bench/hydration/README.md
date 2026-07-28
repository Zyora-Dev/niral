# Niral head-to-head benchmarks

Reproducible comparisons against React 19 and Svelte 5 — identical 1000-row
SSR'd page per framework (`{ id, text, done }` rows, conditional class, a
reactive `<h1>` counter), same static server, same machine, same metric.

## Run it

```sh
npm install            # react/svelte/esbuild — bench only, the framework stays zero-dep
node build.js          # builds dist/{niral,react,svelte}
node serve.js          # http://localhost:4600/{niral,react,svelte}/
node ssr-bench.js      # server-render throughput
```

Hydration is measured in a real browser: `window.__t0` (inline `<script>` at
the top of `<head>` — parse start) → framework-reported `window.__hydrated`
(a post-hydration microtask). Drive it with Playwright or by hand; use ≥9
loads per framework in **alternating order** and report median + min + p90 —
single loads are noise.

## Results (2026-07-27 · M-series MacBook Air, idle · Node 25 · Chromium)

### Hydration — 1000 rows, 13 alternating rounds

| framework | median | min | p90 | JS shipped |
|-----------|-------:|----:|----:|-----------:|
| **niral** | **6.6 ms** | 5.3 | **9.1** | **29.7 KB** |
| svelte 5.56 | 6.4 ms | 5.2 | 15.8 | 51.1 KB (min) |
| react 19.2 | 20.3 ms | 17.3 | 22.5 | 189.0 KB (min) |

### SSR throughput — same page × 200 renders (20 warmup, output consumed)

| framework | ms/render | renders/sec |
|-----------|----------:|------------:|
| svelte 5.56 | 0.18 | ~5,600 |
| **niral** | **0.18–0.24** | **~4,200–5,500** |
| react 19.2 | 2.5 | ~395 |

## Fairness notes

- All three serve static HTML + static JS from the same server; props are
  embedded server-side for all three (no data fetch in the measured window).
- niral output is a real `niral export` of a real project — the exact
  pipeline users get, not a hand-tuned bundle.
- React and Svelte client bundles are esbuild-minified production builds;
  niral ships its normal comment-stripped (not minified) runtime.
- `ssr-bench.js` consumes every render's output through a length sink —
  Svelte's `render()` result is lazy enough that unconsumed output measures
  as ~0 ms.
- Numbers vary ±30% between browser sessions and with machine load; compare
  frameworks **within one session**, alternate order, prefer medians.
