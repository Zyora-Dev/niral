// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 ZyoraLabs. Runtime Library Exception applies — see LICENSE.
import { parseNiralScript, analyzeNiralScript } from "./parser.js";
import { linkNiralScript } from "./modules.js";

export function checkNiralScript(source, filename = "<anonymous>", options = {}) {
  const program = linkNiralScript(parseNiralScript(source, filename), options.resolveModule);
  const analysis = analyzeNiralScript(program, { topLevelAwait: true, ...options });
  return { program, analysis };
}