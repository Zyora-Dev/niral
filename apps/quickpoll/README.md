# quickpoll

Built with [niral](https://github.com/zyoralabs/niral) — zero dependencies.

```sh
niral dev        # develop — HMR, error overlays, http://localhost:5199
niral check      # real TypeScript checking (after: niral add typescript)
niral build      # content-hashed release with atomic activation
niral start      # production server for dist/current
niral export     # static site (when no server features are used)
```

Add capabilities as you need them:

```sh
niral add auth        # passkeys + passwords + 2FA + guarded routes
niral add tailwind    # standalone Tailwind (no npm)
niral add chat        # streaming AI chat (set NIRAL_AI_URL)
niral add sqlite      # a database-backed route
```
