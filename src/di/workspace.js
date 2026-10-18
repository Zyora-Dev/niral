import { constants, openSync, closeSync, fstatSync, readFileSync, writeFileSync, lstatSync, readdirSync, realpathSync, mkdirSync, renameSync, rmSync, existsSync, chmodSync } from "node:fs";
import { resolve, relative, join, dirname, basename, extname, isAbsolute, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";

const PRIVATE_NAMES = /^(?:data|node_modules|dist|build|coverage|vendor|backups?|secrets?|credentials?|\..*)$|(?:^|[._-])(?:env|secrets?|credentials?|private-key|tokens?|passwords?)(?:$|[._-])/i;
const TEXT_EXTENSIONS = new Set([".niral", ".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx", ".css", ".html", ".md", ".json", ".txt", ".sql"]);
const MAX_FILE = 24 * 1024;
const hash = (content) => createHash("sha256").update(content).digest("hex");
const inside = (root, file) => file === root || file.startsWith(root + sep);

export function createWorkspaceTools({ root, home, readOnly = false }) {
  const workspace = realpathSync(resolve(root));
  let homeParent = resolve(home);
  const missingParts = [];
  while (!existsSync(homeParent)) {
    missingParts.unshift(basename(homeParent));
    homeParent = dirname(homeParent);
  }
  const privateHome = join(realpathSync(homeParent), ...missingParts);
  if (!lstatSync(workspace).isDirectory() || inside(privateHome, workspace)) throw new Error("DI: choose an application workspace outside NIRAL_HOME");
  const backupRoot = join(privateHome, "di-backups", randomUUID());

  function locate(path, { file = false } = {}) {
    if (typeof path !== "string" || !path || path.length > 1024 || isAbsolute(path) || /[\\\x00-\x1f\x7f:]/.test(path)) throw new Error("DI: invalid workspace path");
    const parts = path.split("/");
    if (path !== "." && parts.some((part) => !part || part === "." || part === ".." || PRIVATE_NAMES.test(part))) throw new Error("DI: private or escaping path");
    const target = resolve(workspace, path);
    if (!inside(workspace, target) || inside(privateHome, target)) throw new Error("DI: path outside permitted workspace");
    let cursor = workspace;
    for (const part of relative(workspace, target).split(sep).filter(Boolean)) {
      cursor = join(cursor, part);
      const info = lstatSync(cursor, { throwIfNoEntry: false });
      if (info?.isSymbolicLink() || (cursor !== target && info && !info.isDirectory())) throw new Error("DI: symlink or invalid parent");
    }
    if (file && (!TEXT_EXTENSIONS.has(extname(target).toLowerCase()) || target === workspace)) throw new Error("DI: only supported source/text files are available");
    return target;
  }

  function snapshot(path) {
    const target = locate(path, { file: true });
    if (!existsSync(target)) return null;
    const descriptor = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const info = fstatSync(descriptor);
      if (!info.isFile() || info.nlink !== 1 || info.size > MAX_FILE) throw new Error("DI: file is not a bounded single-link text file");
      const data = readFileSync(descriptor);
      const content = new TextDecoder("utf-8", { fatal: true }).decode(data);
      if (content.includes("\0")) throw new Error("DI: binary content is unavailable");
      return { content, hash: hash(data), mode: info.mode & 0o777 };
    } finally { closeSync(descriptor); }
  }

  function tool(name, description, properties, execute) {
    const keys = Object.keys(properties);
    return {
      name, description,
      parameters: { type: "object", properties, required: keys, additionalProperties: false },
      validate: (args) => {
        if (!args || Array.isArray(args) || typeof args !== "object" || Object.keys(args).length !== keys.length || keys.some((key) => !(key in args))) return false;
        try {
          locate(args.path, { file: name !== "list_files" });
          if (name === "write_file") return typeof args.content === "string" && !args.content.includes("\0") && Buffer.byteLength(args.content) <= MAX_FILE && (args.expectedHash === null || (typeof args.expectedHash === "string" && /^[a-f0-9]{64}$/.test(args.expectedHash)));
          return true;
        } catch { return false; }
      },
      execute: (args, { signal } = {}) => { signal?.throwIfAborted(); return execute(args); },
    };
  }
  const pathSchema = { type: "string", description: "Workspace-relative path using /; '.' lists the workspace root." };
  const tools = [
    tool("list_files", "List one directory, excluding private paths and symlinks. Requires user approval.", { path: pathSchema }, ({ path }) => {
      const entries = readdirSync(locate(path), { withFileTypes: true });
      const visible = [];
      for (const entry of entries) {
        const child = path === "." ? entry.name : `${path}/${entry.name}`;
        try { locate(child, { file: !entry.isDirectory() }); } catch { continue; }
        if (!entry.isDirectory() && !entry.isFile()) continue;
        visible.push({ name: entry.name, directory: entry.isDirectory() });
        if (visible.length === 100) break;
      }
      return { entries: visible, limited: visible.length === 100 };
    }),
    tool("read_file", "Read an approved UTF-8 source/text file (24 KiB maximum); returns a hash required for edits. Read AGENTS.md before editing if present.", { path: pathSchema }, ({ path }) => {
      const current = snapshot(path);
      if (!current) throw new Error("DI: file not found");
      return { content: current.content, hash: current.hash };
    }),
  ];
  if (!readOnly) tools.push(tool("write_file", "Create or replace an approved source/text file, with an external backup. Use the read_file hash for edits, null only for new files. No deletion or shell execution.", {
    path: pathSchema, content: { type: "string" }, expectedHash: { type: ["string", "null"] },
  }, ({ path, content, expectedHash }) => {
    const current = snapshot(path);
    if ((current?.hash ?? null) !== expectedHash) throw new Error("DI: file changed; read it again before editing");
    const target = locate(path, { file: true });
    mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
    const backup = join(backupRoot, `${randomUUID()}.json`);
    writeFileSync(backup, JSON.stringify({ path: target, original: current?.content ?? null, hash: current?.hash ?? null }), { flag: "wx", mode: 0o600 });
    mkdirSync(dirname(target), { recursive: true });
    locate(path, { file: true });
    const temporary = join(dirname(target), `.di-edit-${randomUUID()}`);
    try {
      writeFileSync(temporary, content, { flag: "wx", mode: current?.mode ?? 0o644 });
      if (current) chmodSync(temporary, current.mode);
      if ((snapshot(path)?.hash ?? null) !== expectedHash) throw new Error("DI: file changed during edit");
      renameSync(temporary, target);
    } finally { rmSync(temporary, { force: true }); }
    return { written: path, hash: hash(Buffer.from(content)), backup };
  }));
  return tools;
}