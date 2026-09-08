import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { scanEndpoints } from "../server/router.js";

export function addApi({ root = "." } = {}) {
  const routes = join(resolve(root), "routes");
  const target = join(routes, "api", "index.server.js");
  const endpoints = scanEndpoints(routes);
  if (existsSync(target) || endpoints.some((endpoint) => endpoint.pattern === "/api")) throw new Error("An /api endpoint already exists");
  if (["niral", "jsx", "tsx"].some((extension) => existsSync(join(routes, `api.${extension}`)) || existsSync(join(routes, "api", `index.${extension}`)))) throw new Error("A page already owns /api");
  mkdirSync(join(routes, "api"), { recursive: true });
  writeFileSync(target, `export function GET({ url }) {
  return Response.json({ message: "Hello from Niral", query: url.searchParams.get("q") });
}

export async function POST({ request }) {
  const body = await request.json();
  if (typeof body?.message !== "string" || !body.message.trim()) {
    return Response.json({ error: "message is required" }, { status: 422 });
  }
  return Response.json({ message: body.message.trim() }, { status: 201 });
}
`);
  console.log("niral: API ready at /api - edit routes/api/index.server.js");
  return { file: target };
}