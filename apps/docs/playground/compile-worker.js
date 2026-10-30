import { compileNiralScript } from "./compiler/compile.js";

self.onmessage = ({ data }) => {
  try {
    if (typeof data !== "string" || data.length > 50000) throw new Error("Source exceeds the 50,000 character limit.");
    const { code } = compileNiralScript(data, "playground.nrs", { globals: ["print"] });
    if (code.length > 250000) throw new Error("Generated JavaScript exceeds the playground limit.");
    self.postMessage({ code });
  } catch (error) {
    self.postMessage({ error: `${error.code ? `${error.code} at ${error.line}:${error.col}: ` : ""}${error.message}${error.hint ? `\n${error.hint}` : ""}` });
  }
};
self.postMessage({ ready: true });