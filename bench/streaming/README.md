# Niral streaming SSR benchmark — time-to-first-byte

The [end-to-end bench](../e2e/) measures steady-state throughput on a fixed
page. This one measures the thing **streaming** is actually for: how fast the
browser sees *something* when part of the page depends on slow data.

Each framework serves two routes that both need a value which takes
`BENCH_DELAY` ms (default 300) to produce:

- **`/blocking`** — awaits the slow value before sending anything (baseline)
- **`/streaming`** — flushes the shell immediately, streams the value on settle
  - niral — `<script stream>` + `{#await}`
  - next — `<Suspense>` + async server component
  - sveltekit — promise returned from `load()` + `{#await}`

## Run it

```sh
node run.js                 # builds all three from ../e2e/apps, then measures
BENCH_DELAY=500 node run.js  # heavier slow value
```

The routes are added to the existing `../e2e/apps` (they reuse those installed
builds and deps — the framework itself stays zero-dep). Tunables:
`BENCH_DELAY` (default 300 ms) · `BENCH_ITER` (default 25, first 5 are warmup).

## What is measured

Every request is timed over raw `node:http` so we see the real chunk timeline:

1. **TTFB** — time to the first response byte
2. **shell** — time until `SHELL READY` (above-the-fold content) has arrived
3. **data** — time until the slow value (`STREAMED-OK`) has arrived
4. **total** — time to the last byte

## Results (2026-08-04 · M-series MacBook Air, idle · Node 25 · slow value = 300 ms)

| framework | route | TTFB | shell | data | total |
|-----------|-------|-----:|------:|-----:|------:|
| **niral** | blocking | 304 ms | 304 ms | 304 ms | 304 ms |
| **niral** | **streaming** | **2 ms** | **2 ms** | 303 ms | 303 ms |
| next 16 (react 19) | blocking | 307 ms | 307 ms | 307 ms | 308 ms |
| next 16 (react 19) | **streaming** | 6 ms | 6 ms | 305 ms | 306 ms |
| sveltekit 2 (svelte 5) | blocking | 305 ms | 305 ms | 305 ms | 305 ms |
| sveltekit 2 (svelte 5) | **streaming** | 3 ms | 3 ms | — | 304 ms |

- **Streaming collapses TTFB from ~305 ms to single digits** on all three — the
  shell paints immediately while the 300 ms data streams in behind it. `total`
  stays ~300 ms either way: streaming doesn't make slow data faster, it stops it
  from blocking everything else.
- **niral has the fastest first byte** — 2 ms, vs Next 6 ms.
- niral's slow value lands at 303 ms as **real server-rendered HTML** in the wire
  bytes (`<p>STREAMED-OK…</p>`), revealed by a tiny inline script — no framework
  JS required for it to appear.

## Honest note on the SvelteKit "—"

It is **not** a failure. niral and Next.js *stream the rendered HTML* of the
resolved branch, so the marker text shows up in the response body. SvelteKit
instead *serializes the promise's value into a client data payload* and resolves
the `{#await}` on the client after hydration — so the rendered text never appears
in the server stream (the connection does stay open ~304 ms delivering that data
chunk). Practically: niral's and Next's streamed content is visible without JS;
SvelteKit's deferred value needs the client to render it.

## Fairness notes

- All three serve identity bytes (`accept-encoding: identity`) so the comparison
  is about render/flush timing, not compression.
- Each runs its own shipped production server (`niral start`, `next start`,
  adapter-node), single process, default settings.
- The slow value is a plain `setTimeout` — a stand-in for a slow query, upstream
  API, or LLM call. The absolute delay is arbitrary; what matters is TTFB/shell
  landing *before* it.
- Numbers vary with hardware and load. The bench is reproducible — run it
  yourself.
