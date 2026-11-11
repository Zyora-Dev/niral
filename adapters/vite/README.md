# @niral/vite

A Vite plugin that lets you `import` **NiralScript** (`.nrs`) files directly in any
Vite app — React, Vue, Svelte, or vanilla.

Each `.nrs` file is compiled (via the `niralscript` compiler) to the standalone ES
module that `nrs compile` emits — exporting `createInstance` plus your top-level
exports — with a real source map and hot-module replacement in dev.

Vite is a **peer dependency**; the plugin's only dependency is the NiralScript
compiler itself.

## Install

```sh
npm install -D @niral/vite vite
npm install @niral/react react   # to use .nrs as React components
```

## Configure

```js
// vite.config.js
import niralscript from "@niral/vite";

export default {
  plugins: [niralscript()],
};
```

Options:

| Option | Default | Description |
| --- | --- | --- |
| `strictTypes` | `false` | Enable NiralScript strict type checking during transform. |
| `hmr` | `true` in `serve` | Inject a self-accepting HMR footer so `.nrs` edits hot-swap. |

## Use

```jsx
import * as counter from "./counter.nrs";
import { useNrs } from "@niral/react";

function Counter({ initial }) {
  const c = useNrs(counter, { initial });
  return <button onClick={c.increment}>{c.count}</button>;
}
```

Editing `counter.nrs` in dev hot-replaces the module; compile errors surface in the
Vite overlay with the original `.nrs` location and NiralScript diagnostic code.

## Notes

- Modules using top-level `await` compile to an `async createInstance` and skip the
  HMR footer (they can't be synchronously hot-accepted).
- This plugin handles the import/transform step only; the React bridge lives in
  [`@niral/react`](../react/README.md).

## License

Apache-2.0 with the Runtime Library Exception — see the repository `LICENSE`.
