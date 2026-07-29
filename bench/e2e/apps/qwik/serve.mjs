// Minimal Qwik City node server — uses Qwik's official node middleware directly
// (equivalent to what the node-server adapter generates). Serves the built SSR
// render + static assets. Dynamic SSR on every request.
import { createQwikCity } from "@builder.io/qwik-city/middleware/node";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import render from "./server/entry.ssr.js";
import qwikCityPlan from "./server/@qwik-city-plan.js";

const here = dirname(fileURLToPath(import.meta.url));
const { router, notFound, staticFile } = createQwikCity({
  render,
  qwikCityPlan,
  static: { root: join(here, "dist") },
});

const server = createServer((req, res) => {
  staticFile(req, res, () => router(req, res, () => notFound(req, res, () => {})));
});
server.listen(Number(process.env.PORT) || 4706, process.env.HOST || "127.0.0.1");
