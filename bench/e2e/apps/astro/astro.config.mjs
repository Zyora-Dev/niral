import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// dynamic SSR on every request — standalone node server, no prerender
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
});
