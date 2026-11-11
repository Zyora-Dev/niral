# @niral/next

Import [NiralScript](https://github.com/Zyora-Dev/niralscript) (`.nrs`) files
directly in a **Next.js App Router** app and consume them as Client Components
via [`@niral/react`](../react).

## Install

```sh
npm install @niral/next @niral/react niralscript
```

`next` and `react` are peer dependencies.

## Setup

Wrap your Next config:

```js
// next.config.mjs
import { withNiral } from "@niral/next";

export default withNiral({
  reactStrictMode: true,
});
```

`withNiral` registers a loader for `.nrs` in **both** webpack (`next build`,
`next dev`) and Turbopack (`next dev --turbo`). The compiled module is emitted
with a `"use client"` directive, so a `.nrs` component lives on the Client
Component side of the RSC boundary.

## Usage

```js
// app/counter.jsx
"use client";
import * as counter from "./counter.nrs";
import { useNrs } from "@niral/react";

export default function Counter() {
  const c = useNrs(counter, { initial: 0 });
  return (
    <button onClick={c.increment}>
      {c.count} / {c.doubled}
    </button>
  );
}
```

```nrs
// app/counter.nrs
input initial: number
state count: number = initial
derive doubled: number = count * 2
export function increment(): number { count += 1; return count }
```

A Server Component can import and render `<Counter />` normally — Next treats it
as a client island.

## Options

```js
export default withNiral(nextConfig, { strictTypes: true });
```

| Option        | Default | Description                              |
| ------------- | ------- | ---------------------------------------- |
| `strictTypes` | `false` | Enable NiralScript strict type checking. |

## Notes

- `.nrs` files are reactive **client** logic; they run after hydration via
  `useNrs`. For server-rendered markup, the initial reactive values are rendered
  by React during SSR and then hydrated on the client.
- Top-level `await` in `.nrs` is not supported through the synchronous `useNrs`
  hook path.
- Zero extra dependencies: the only dependency is the `niralscript` compiler;
  `next` and `react` are peers.
