#!/usr/bin/env node
// niral <command> — forwards to the framework at ~/.niral/framework.
// Available globally after `npm i -g create-niral`, or per-call via `npx niral dev`.
import { ensureFramework, runNiral } from "../index.js";

await ensureFramework();
process.exit(runNiral(process.argv.slice(2)));
