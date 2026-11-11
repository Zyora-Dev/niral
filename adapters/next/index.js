// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 ZyoraLabs. Runtime Library Exception applies — see LICENSE.
/**
 * NiralScript → Next.js adapter (App Router).
 *
 * Wrap your Next config so `.nrs` files compile through the NiralScript
 * compiler, then consume them as Client Components via `@niral/react`:
 *
 *   // next.config.mjs
 *   import { withNiral } from "@niral/next";
 *   export default withNiral({ reactStrictMode: true });
 *
 *   // app/counter.jsx
 *   "use client";
 *   import * as counter from "./counter.nrs";
 *   import { useNrs } from "@niral/react";
 *   export default function Counter() {
 *     const c = useNrs(counter, { initial: 0 });
 *     return <button onClick={c.increment}>{c.count}</button>;
 *   }
 *
 * `withNiral` registers the webpack loader for `.nrs` and mirrors it in
 * Turbopack rules, so both `next dev` and `next build` work. The compiled
 * module is marked `"use client"` (NiralScript is reactive client logic), so it
 * naturally sits on the Client Component side of the App Router boundary.
 */

const loaderPath = new URL("./loader.js", import.meta.url).pathname;

/**
 * @param {import("next").NextConfig} [nextConfig]
 * @param {object} [options]
 * @param {boolean} [options.strictTypes]  Enable NiralScript strict type checking.
 * @returns {import("next").NextConfig}
 */
export function withNiral(nextConfig = {}, options = {}) {
  const loaderOptions = { strictTypes: options.strictTypes ?? false };

  const turbopackRule = {
    "*.nrs": {
      loaders: [{ loader: loaderPath, options: loaderOptions }],
      as: "*.js",
    },
  };

  return {
    ...nextConfig,

    // Turbopack rules. Next 13/14 read `experimental.turbo.rules`; Next 15 added
    // the stable top-level `turbopack.rules`. We set the experimental key (quiet
    // on 14) and let the user opt into the top-level key on 15 if they prefer.
    experimental: {
      ...(nextConfig.experimental ?? {}),
      turbo: {
        ...(nextConfig.experimental?.turbo ?? {}),
        rules: {
          ...(nextConfig.experimental?.turbo?.rules ?? {}),
          ...turbopackRule,
        },
      },
    },

    webpack(config, context) {
      config.module = config.module ?? {};
      config.module.rules = config.module.rules ?? [];
      config.module.rules.push({
        test: /\.nrs$/,
        use: [{ loader: loaderPath, options: loaderOptions }],
      });
      // Preserve any user-provided webpack hook.
      if (typeof nextConfig.webpack === "function") {
        return nextConfig.webpack(config, context);
      }
      return config;
    },
  };
}

export default withNiral;
