#!/usr/bin/env node
// niral <command> — forwards to the framework at ~/.niral/framework.
// Available globally after `npm i -g create-niral`, or per-call via `npx niral dev`.
import { ensureFramework, runNiral } from "../index.js";

async function main() {
	await ensureFramework();
	return runNiral(process.argv.slice(2));
}

main().then((code) => {
	process.exitCode = code;
}).catch((error) => {
	console.error(`niral: ${error?.message || error}`);
	process.exitCode = 1;
});
