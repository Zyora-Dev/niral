# Niral browser smoke tests

The main suite (`npm test` at the repo root) runs in a DOM **shim** — fast, but
a shim can't catch browser-only bugs (e.g. `{@html}` hydration, where a real
browser parses raw HTML into many nodes but the shim keeps it as one).

This suite boots a real niral app and drives it in **headless Chromium**,
asserting the things only a real browser can prove:

- the page server-renders, then hydrates with **zero console warnings**
- reactivity updates the **actual DOM** (click the counter → text changes)
- a **server RPC** round-trips from the browser
- **two-way binding** + keyed-list add works
- **client-side navigation** works
- local Devtools filters, loader/RPC details, pause/clear/refresh, keyboard focus,
  mobile bounds and icon loading work; the inspector is absent from production
- the Errors tab captures browser errors, rejections and contained runtime errors;
    caught/concurrent/streamed RPCs join exact server traces, network failures stay
    unlinked, click attribution and verified source links work, repeated errors
    group, sensitive values stay absent, and error history can be cleared

## Run

```sh
npm install                 # playwright — dev-only, isolated here
npx playwright install chromium   # one-time browser download
npm test
npm run test:forms
```

To run only the inspector scenarios from this folder:

```sh
NIRAL_BROWSER_FILTER=Devtools npm test
```

These scenarios build disposable fixtures, not the documentation website. The
error scenario deliberately throws test errors; unexpected page errors still fail
the test. It checks 320/390/768/1440px layouts and saves desktop/mobile screenshots
in the system temporary directory.

The framework itself never depends on Playwright — this folder has its own
`package.json`, exactly like `bench/`. Keeps the zero-dependency promise intact.

`test:forms` starts isolated dev and production apps on available ports. It
checks reactive pending/error/success state, focus and file retention, submitter
values, duplicate protection, independent forms, reset races, redirects, and
JavaScript-disabled submission. With and without layouts, it also verifies
loader refresh, keyed-row identity, focus/files/scroll and layout state,
separate save/read errors, retry, and delayed refresh responses after navigation.
Navigation coverage includes delayed fetch and module-import races, reactive
loading state, shared and nested layout identity, context inheritance, lifecycle
cleanup, page-local state resets and destination prop initialization. It also
checks slot fallbacks, hydration warnings, heading/anchor focus, same-page hashes,
cross-route anchors, Back/Forward window scroll restoration and custom history state.
Temporary app files and servers are cleaned up.
