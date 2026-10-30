import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function preparePlayground(root = fileURLToPath(new URL("./", import.meta.url))) {
  const destination = join(root, "playground", "compiler");
  mkdirSync(destination, { recursive: true });
  mkdirSync(join(root, "lib"), { recursive: true });
  writeFileSync(join(root, "lib", "playground-sandbox.json"), JSON.stringify(readFileSync(new URL("./lib/playground-sandbox.js", import.meta.url), "utf8")));
  for (const name of ["analysis", "check", "compile", "contracts", "errors", "expressions", "modules", "parser", "scanner", "types"]) {
    copyFileSync(new URL(`../../niralscript/${name}.js`, import.meta.url), join(destination, `${name}.js`));
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) preparePlayground();