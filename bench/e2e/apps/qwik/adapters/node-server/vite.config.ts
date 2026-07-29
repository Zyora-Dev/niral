import { nodeServerAdapter } from "@builder.io/qwik-city/adapters/node-server/vite";
import { extendConfig } from "@builder.io/qwik-city/vite";
import baseConfig from "../../vite.config";

export default extendConfig(baseConfig, () => ({
  build: {
    ssr: true,
    rollupOptions: { input: ["src/entry.ssr.tsx", "@qwik-city-plan"] },
  },
  plugins: [nodeServerAdapter({ name: "node-server" })],
}));
