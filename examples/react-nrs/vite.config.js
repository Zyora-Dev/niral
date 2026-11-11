import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import niralscript from "@niral/vite";

export default defineConfig({
  plugins: [niralscript(), react()],
  build: { minify: false },
});
