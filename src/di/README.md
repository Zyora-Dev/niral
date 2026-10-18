# Niral DI

Local, zero-dependency Developer Intelligence through `niral di`, backed by
provider adapters and an approval-gated tool loop. The existing npm launchers
forward these commands; no new package or Niral Cloud account is needed. No
runtime application imports DI, and application `NIRAL_AI_*` settings are separate.

## CLI Commands

```sh
niral di setup --protocol responses --base-url https://your-provider.example/v1 --model YOUR_EXACT_MODEL --auth bearer --key-env NIRAL_DI_API_KEY
niral di status
niral di ask "Explain this project's routing" --root ./myapp --read-only
niral di ask "Add a contact page" --root ./myapp
niral di chat --root ./myapp
niral di new myblog "Customize the blog home page" --template blog
niral di ask "Explain Niral server blocks" --no-tools
```

Replace the placeholder endpoint/model with your chosen provider's exact values.
Set the named credential variable privately in your terminal or credential manager,
not in command arguments, shell history, project files or chat. No `.env` file is
loaded. `setup` writes only settings and the variable name to `NIRAL_HOME/di.json`
(default `~/.niral/di.json`, mode 0600). It makes no API request; use `--replace`
to intentionally replace existing settings. `status` is offline and never prints
the credential. DI requires no default cloud service; a compatible loopback
endpoint can use explicit `--auth none`.

The base URL excludes `/responses`, `/chat/completions` or `/messages` and excludes
query parameters. Pass a required API version using `--api-version VERSION`.
Protocols: `responses`, `chat-completions`, `anthropic`. Auth: `bearer`, `api-key`,
`x-api-key`, `none`. No model fallback or automatic provisioning.

`ask` performs one bounded agent run. `chat` repeats it, retaining at most eight
user/assistant text exchanges and 32 KiB of serialized context in memory; file
results are not automatically retained across runs. `/clear` resets context and
`/exit` exits. Prompts are limited to 32 KiB. Ctrl-C cancels pending work.
`new` requires a simple new/empty directory name under the current directory;
templates are `minimal`, `blog` and `dashboard`. It asks before scaffolding and
preserves the scaffold if a later model request fails. No dependency installation,
tests, dev-server startup or deployment is performed.

### Approval And Files

Interactive workspace sessions first disclose the configured destination/model.
Each requested tool then prints JSON-escaped arguments and waits for `y`; blank
or any other response denies it. There is no auto-approve option. Noninteractive
use requires `ask <prompt> --no-tools`, which sends only the explicit prompt.
`--read-only` registers listing/reading tools but no writes; it still needs approval.

- `list_files`: one directory, up to 100 visible entries, no recursive scan.
- `read_file`: UTF-8 source/text files up to 24 KiB, returns content and SHA-256.
- `write_file`: full-content create/replace, up to 24 KiB. Existing files require
  the hash from a read; new files require `expectedHash: null`. Stale edits fail.
  The approval shows the proposed full content, not a computed diff.

Paths stay within the selected workspace. Dot paths, conventional `data`, build,
dependency, backup and secret paths, symlinks, hard-linked file reads/writes,
binary files and unsupported extensions are excluded. Supported extensions:
`.niral`, `.js`, `.mjs`, `.cjs`, `.ts`, `.jsx`, `.tsx`, `.css`, `.html`, `.md`,
`.json`, `.txt`, `.sql`. Config/backups under NIRAL_HOME are excluded even when
that directory is inside the chosen workspace. Gitignore rules are not interpreted;
path exclusions cannot detect secrets embedded in ordinary source. Review every
read approval before allowing its content to reach your selected provider.

Before writes, original content and its absolute path/hash are stored as a private
JSON record under `NIRAL_HOME/di-backups/<run-id>/`; original is null for new files.
Backups are retained without pruning. Restore manually after reviewing subsequent
changes. Successful writes use a temporary file and rename, preserving permissions.
There is no deletion, shell execution, automatic rollback or automatic test run.
Run `niral check`, `niral test` and `niral build` yourself after reviewing changes.
Cancellation/failure does not undo completed edits. Path/hash checks are guardrails,
not an OS sandbox against concurrent hostile filesystem mutation or prompt injection.
The model is instructed to inspect applicable AGENTS.md files; that is guidance,
not a substitute for approval. No transcript is written. Provider retention and
charges depend on your provider; Responses `store:false` is not a general guarantee.

## Provider Configuration

Import `createProvider` from `./provider.js`. It takes explicit configuration;
there is no default endpoint, model, credential discovery or model fallback.

| Option | Meaning |
| --- | --- |
| `protocol` | `chat-completions`, `responses` or `anthropic` |
| `baseURL` | API base, including its version prefix; the adapter appends the operation path |
| `model` | Exact model name, or Azure deployment name |
| `auth` | `bearer`, `api-key`, `x-api-key` or explicit `none` |
| `apiKey` | In-memory credential supplied by the host |
| `getCredential({ signal })` | Optional async credential callback, called on each request; overrides `apiKey` |
| `apiVersion` | Optional `api-version` query value, or Anthropic version header |
| `maxOutputTokens` | Defaults to 4096 |
| `timeoutMs` | Network request/body timeout, defaults to 120000 |
| `maxRequestBytes` | Serialized request limit, defaults to 2 MiB |
| `maxResponseBytes` | Response body limit, defaults to 4 MiB |

Examples of base URLs: `https://api.openai.com/v1`,
`https://api.anthropic.com/v1`, and
`https://YOUR-RESOURCE.openai.azure.com/openai/v1`. Azure API-key authentication
uses `auth: "api-key"`; an externally acquired Entra token uses `auth: "bearer"`.
Niral does not provision Azure resources or acquire Entra credentials itself.
Anthropic defaults to `x-api-key` and version `2023-06-01`; other protocols default
to bearer authentication. HTTPS is required except for local loopback endpoints.
Redirects, embedded URL credentials, query strings and fragments are rejected.

`provider.complete({ system, messages, tools, signal })` returns an assistant
message with `content`, `toolCalls`, `refused`, `usage` and opaque `native`
continuation state. Tool calls contain `{ id, name, arguments }`. Preserve the
returned message intact for the next request and do not move it between protocols.
Responses reasoning items and Claude thinking/signature blocks are retained.
Responses uses `store: false` and requests encrypted reasoning continuation;
this is not a claim about the provider's broader data-retention policy.

Only completed, non-streaming function-tool responses are supported. Truncated,
unsupported and malformed responses are errors, not executable tool requests.
Chat requests use `max_completion_tokens`. Compatible endpoints must support the
chosen wire format and model's function calling. Live verification is limited to
the Azure Responses smoke test below. Provider errors omit raw bodies and credentials. Normal model
content is not automatically redacted: the host controls what it sends and logs.

## Host Tool Contract

Import `runAgent` from `./agent.js` and pass:

- `provider`, `prompt` and optional `system` instructions.
- `tools`: objects with `name`, `description`, JSON Schema `parameters`,
  `validate(arguments, { signal })` and `execute(arguments, { signal })`.
- `authorize(call, { signal })`: must return exactly `true` to execute a call.
  Omission, false or any other return value denies execution.
- Optional `signal`, `maxTurns` (8), `maxToolCalls` (32),
  `maxToolResultBytes` (64 KiB) and whole-run `timeoutMs` (300000).

The schema describes the tool to the provider; it is not permission or local
validation. A mandatory host validator must check the entire input and return
exactly `true`, including field types, required keys and unwanted properties.
The loop validates all calls in a response before executing any of that batch.
Unknown tools, repeated IDs, malformed arguments and exceeded limits stop the
run. Each valid call is separately authorized and executed sequentially.

Denied calls and tool failures become generic error results. Raw tool exceptions
are not sent to the model. There is no automatic request or tool retry. Tool
results must be text or JSON-serializable values within the configured byte limit.
Calls denied by the host still consume the call budget. The final allowed turn
cannot execute tools because there would be no remaining turn to interpret their
results. The return value includes text, refusal state, turn/call counts,
per-turn usage and in-memory messages; no transcript is persisted automatically.

Cancellation and deadlines stop the loop waiting and prevent subsequent calls.
Host validators, authorization callbacks and executors receive an AbortSignal
and must cooperate with cancellation. Arbitrary in-process code cannot be forcibly
stopped or rolled back; already-started writes can outlive cancellation, and a
failed run may have completed earlier tools. Do not automatically retry writes.

The CLI host implements the filesystem controls described above. Other hosts
remain responsible for their own confinement, permissions, checkpoints and output
disclosure. The loop itself is not a sandbox or prompt-injection defense.
Streaming and broader live-provider checks remain future work.

## Verification

Run `node tests/di.js` and `node tests/di-cli.js` for deterministic mocked protocol,
execution, CLI and workspace tests. Both are registered in `npm test`. They make no paid API requests and
need no credentials, SDKs or cloud account.

On 2026-10-18 a separate live Azure Responses smoke test passed against the
user-selected deployment `gpt-6.1-sol` with API version `2025-04-01-preview`.
Two model turns completed one validated and authorized synthetic tool call; the
final answer contained its randomly generated return value. Usage was 245 input
and 51 output tokens. The test used no repository content, persisted no key and
made no production changes. This verifies that deployment's basic tool round
trip, not every Responses feature or other provider protocols.