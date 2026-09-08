import { readFileSync, realpathSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative, dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isBuiltin } from "node:module";

export function moduleSpecifiers(source, { strict = false } = {}) {
  const tokens = [...source.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g)]
    .map((match) => match[0]).filter((token) => !token.startsWith("//") && !token.startsWith("/*"));
  const specs = [];
  const quoted = (token) => token?.startsWith('"') || token?.startsWith("'");
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    let spec;
    if (token === "from" && quoted(tokens[index + 1])) spec = tokens[index + 1];
    if (token === "import" && tokens[index - 1] !== ".") {
      if (quoted(tokens[index + 1])) spec = tokens[index + 1];
      if (tokens[index + 1] === "(") {
        if (!quoted(tokens[index + 2]) || ![",", ")"].includes(tokens[index + 3])) {
          if (strict) throw new Error("Endpoint dynamic imports must use literal module paths");
        } else spec = tokens[index + 2];
      }
    }
    if (strict && token.startsWith("`") && /\bimport\s*\(/.test(token)) throw new Error("Endpoint imports inside template expressions are not supported");
    if (spec) {
      if (spec.includes("\\")) throw new Error("Endpoint import paths cannot contain escapes");
      specs.push(spec.slice(1, -1));
    }
  }
  return specs;
}

export function collectEndpointModules(root, endpoints, { validate = false } = {}) {
  root = realpathSync(root);
  const files = new Map();
  const queue = endpoints.map((endpoint) => endpoint.file);
  while (queue.length) {
    const file = realpathSync(queue.pop());
    const rel = relative(root, file).split(sep).join("/");
    if (rel.startsWith("../") || rel === ".." || /(^|\/)(data|node_modules|dist|\.[^/]*)(\/|$)/.test(rel)) throw new Error(`Endpoint import is outside allowed source files: ${rel}`);
    if (!/\.(?:js|mjs|json)$/.test(rel)) throw new Error(`Endpoint imports require explicit .js, .mjs or .json extensions: ${rel}`);
    if (files.has(rel)) continue;
    const source = readFileSync(file, "utf8");
    files.set(rel, source);
    if (rel.endsWith(".json")) { JSON.parse(source); continue; }
    if (validate) {
      const result = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: source, encoding: "utf8" });
      if (result.error || result.status !== 0) throw new Error(`Invalid endpoint module ${rel}: ${result.error?.message ?? result.stderr}`);
    }
    for (const spec of moduleSpecifiers(source, { strict: true })) {
      if (isBuiltin(spec)) continue;
      if (!spec.startsWith("./") && !spec.startsWith("../")) throw new Error(`Endpoint imports must be relative or Node built-ins: ${spec}`);
      if (/[?#]/.test(spec)) throw new Error(`Endpoint import paths cannot contain query strings or fragments: ${spec}`);
      queue.push(resolve(dirname(file), spec));
    }
  }
  return files;
}

export function writeEndpointModules(destination, files) {
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, "package.json"), '{"type":"module"}\n');
  for (const [rel, source] of files) {
    const file = join(destination, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
}

export async function loadDevEndpoint(root, route, files) {
  const hash = createHash("sha256");
  for (const [rel, source] of [...files].sort(([left], [right]) => left.localeCompare(right))) hash.update(rel).update("\0").update(source);
  const destination = join(root, ".niral", "endpoints", hash.digest("hex").slice(0, 16));
  if (!existsSync(destination)) writeEndpointModules(destination, files);
  return import(pathToFileURL(join(destination, "routes", route.rel)).href);
}