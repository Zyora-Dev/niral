import { parseNiralScript, analyzeNiralScript } from "./parser.js";
import { linkNiralScript } from "./modules.js";

export function checkNiralScript(source, filename = "<anonymous>", options = {}) {
  const program = linkNiralScript(parseNiralScript(source, filename), options.resolveModule);
  const analysis = analyzeNiralScript(program, { topLevelAwait: true, ...options });
  return { program, analysis };
}