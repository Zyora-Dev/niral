# @niral/react

Use compiled **NiralScript** (`.nrs`) modules as reactive **React** components —
inside a real React, Vite, or Next.js app.

NiralScript's compiler emits a runtime-agnostic ES module with its own tiny
reactive core. This adapter bridges that core to React through
[`useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore),
so a `.nrs` file's `state`, `derive`, `input`, and exported functions drive React
re-renders natively — no virtual-DOM shim, no polling.

React is a **peer dependency**. The adapter adds zero runtime dependencies of its
own, matching NiralScript's zero-dependency contract.

## Install

```sh
npm install @niral/react react
# plus a bundler loader that compiles .nrs → an ES module (nrs compile)
```

## Use

A NiralScript module is reactive logic — `input` (props), `state`, `derive`, and
exported functions. It has no markup; React owns the markup.

```jsx
// counter.nrs
//   input initial: number
//   state count: number = initial
//   derive doubled: number = count * 2
//   export function increment(): number { count += 1; return count }

import * as counter from "./counter.nrs";
import { useNrs } from "@niral/react";

export function Counter({ initial }) {
  const c = useNrs(counter, { initial });   // live reactive values + RPCs
  return (
    <button onClick={c.increment}>
      {c.count} (×2 = {c.doubled})
    </button>
  );
}
```

- Reactive bindings (`count`, `doubled`) are read live; the component re-renders
  only when the underlying NiralScript revision changes (`Object.is`-deduped).
- Exported functions (`increment`) are callable directly.
- React props flow into the module's `input` signals automatically on change.

### `bindNrs` — one-liner components

```jsx
import { bindNrs } from "@niral/react";
import * as counter from "./counter.nrs";

export default bindNrs(counter, (c) => (
  <button onClick={c.increment}>{c.count}</button>
));
```

## API

| Export | Description |
| --- | --- |
| `useNrs(module, props?, globals?)` | Mounts one NiralScript instance per component; returns a live view of its reactive values and exported functions. Re-renders on reactive change. |
| `bindNrs(module, render, globals?)` | Wraps a module + render callback into a self-contained React component. |
| `createReactRuntime()` | The subscription-aware runtime injected into `createInstance`; exported for custom integrations. |

## Notes

- `useNrs` does not support modules that use top-level `await` (async
  `createInstance`); keep per-component modules synchronous.
- Server rendering reads the instance's initial revision as its snapshot.

## License

Apache-2.0 with the Runtime Library Exception — see the repository `LICENSE`.
