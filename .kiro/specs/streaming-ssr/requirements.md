# Requirements Document

## Introduction

This feature adds **progressive streaming server-side rendering (SSR)** to the Niral
framework, driven by the `{#await promise}` / `{:then value}` / `{:catch error}` block.

Today the `{#await}` grammar already parses (see `src/compiler/parser.js`,
`src/compiler/ast.js`) and the client runtime resolves promises after hydration
(see `awaitBlock` in `src/runtime/dom.js`). However, the server-side string
renderer is fully synchronous: for a pending promise, `sAwait` in
`src/runtime/ssr.js` emits only the pending placeholder and never resolves or
streams the settled value, and the compiled `__ssr(props)` function returns a
single synchronous string. The existing `<script stream>` route flag
(`src/server/prod.js`, `src/server/page.js` `assemblePageParts`) only flushes the
document shell and `<head>` before `load()` runs, then blocks on a single
full-page render.

The goal is progressive HTML flushing so that a slow server-resolved promise does
not block first paint. The server flushes the initial HTML shell immediately with
a placeholder for each pending `{#await}`, streams each resolved (or rejected)
branch as an out-of-order chunk over a single chunked-transfer HTTP response as the
promise settles, and the client runtime swaps each placeholder in place as its
chunk arrives. The final streamed DOM must be identical to a non-streamed full
render so the existing hydration claim mechanism keeps working.

The feature must respect Niral's hard constraints: zero runtime dependencies (Node
built-ins only), `<server>` code never reaches the client, no new npm packages, and
byte-identical dual codegen (DOM builder and string renderer) wherever possible.

## Glossary

- **Niral_Framework**: The zero-dependency, compiler-first full-stack web framework at `/Users/redfoxhotels/zyorabyte/niral`.
- **Compiler**: The parser → AST → codegen pipeline in `src/compiler/` that turns `.niral` source into a client `__build` function and a server `__ssr` function.
- **Parser**: The recursive-descent parser in `src/compiler/parser.js` that produces the component AST.
- **Await_Block**: The AST node (`AwaitBlock` in `src/compiler/ast.js`) produced from `{#await expr}` `{:then var}` `{:catch var}` `{/await}` source, with `pending`, `thenChildren`, `catchChildren`, `thenVar`, and `catchVar` fields.
- **String_Renderer**: The compiled server-only `__ssr(props)` function plus the helpers in `src/runtime/ssr.js` (`sAwait`, `sText`, `sChild`, etc.) that concatenate HTML directly.
- **Streaming_Renderer**: The new server-only rendering path that produces an initial shell plus an asynchronous sequence of settled Await_Block chunks.
- **Placeholder**: The HTML markup emitted for a pending Await_Block in the initial shell, carrying a unique Await_Id and matching the region-anchor shape (`<!--niral:start-->` / `<!--niral:end-->`) that hydration expects.
- **Await_Id**: A unique identifier assigned to each pending Await_Block within a single page render, used to correlate a streamed chunk with its Placeholder.
- **Chunk**: A unit of HTML written to the response after the shell, containing the settled `{:then}` or `{:catch}` markup for one Await_Block plus the client instruction to swap it into its Placeholder.
- **Swap_Script**: The inline `<script>` emitted with a Chunk that replaces the Placeholder content with the settled markup on the client.
- **Hydration_Runtime**: The client runtime in `src/runtime/dom.js` / `src/runtime/router.js` that claims SSR DOM without rebuilding it.
- **Page_Server**: The prod server (`src/server/prod.js`) and dev server (`src/dev/server.js`) that assemble and write page responses.
- **Load_Loader**: An exported `async function load({ params, locals })` in a `<server>` block that supplies SSR props for a route.
- **Stream_Mode**: The per-route opt-in (today expressed as `<script stream>`, tracked as `route.stream`) that enables progressive streaming for a page.
- **Shell**: The initial HTML flushed before any pending Await_Block settles — document top, `<head>`, styles, and the rendered markup up to and including each Placeholder.

## Requirements

### Requirement 1: Parse `{#await}` blocks into the AST

**User Story:** As a Niral component author, I want to write `{#await promise}` / `{:then value}` / `{:catch error}` blocks, so that I can declare pending, resolved, and error markup for an asynchronous value.

#### Acceptance Criteria

1. WHEN the Parser encounters `{#await expr}` followed by `{/await}`, THE Parser SHALL produce an Await_Block node whose expression is `expr` and whose `pending` children are the nodes between the header and the next branch terminator.
2. WHERE a `{:then var}` branch is present, THE Parser SHALL record `var` as the Await_Block `thenVar` and the following nodes as `thenChildren`.
3. WHERE a `{:catch var}` branch is present, THE Parser SHALL record `var` as the Await_Block `catchVar` and the following nodes as `catchChildren`.
4. WHERE a `{:then}` or `{:catch}` branch omits its variable name, THE Parser SHALL set the corresponding variable field to null and still record the branch children.
5. IF an `{#await}` block reaches end of file without a `{/await}` terminator, THEN THE Parser SHALL raise error NIRAL035 identifying the unclosed block start position.
6. WHEN the Parser reads the `{#await}` expression, THE Parser SHALL read a balanced expression so that braces and quotes inside the expression do not terminate the header.

### Requirement 2: Compile Await_Blocks to a streaming-capable server renderer

**User Story:** As a framework maintainer, I want the compiler to emit a server renderer that can defer pending awaits, so that the server can flush a shell before promises settle.

#### Acceptance Criteria

1. WHEN the Compiler generates the String_Renderer for a component containing an Await_Block, THE Compiler SHALL emit code that assigns a distinct Await_Id to each pending Await_Block instance encountered during a single page render.
2. WHEN the String_Renderer evaluates an Await_Block expression that is not a thenable, THE String_Renderer SHALL render the `{:then}` branch synchronously using the resolved value.
3. WHEN the String_Renderer evaluates an Await_Block expression that is a thenable, THE String_Renderer SHALL emit the pending branch wrapped in a Placeholder carrying the Await_Id and region anchors, and SHALL register the thenable for streaming.
4. THE Compiler SHALL keep all String_Renderer helpers server-only by resolving them through `globalThis.__niralSSR` so that no streaming code is added to the client bundle.
5. WHERE a component contains no Await_Block, THE Compiler SHALL emit a String_Renderer whose output is byte-identical to the output produced before this feature.

### Requirement 3: Flush the initial shell before pending awaits settle

**User Story:** As an end user on a slow network or slow backend, I want the page shell and above-the-await content to appear immediately, so that a slow server-resolved promise does not block first paint.

#### Acceptance Criteria

1. WHERE Stream_Mode is enabled for a route, WHEN the Page_Server begins a page response, THE Page_Server SHALL write the Shell to the response before any pending Await_Block promise settles.
2. WHEN the Page_Server writes a streamed page response, THE Page_Server SHALL set the response headers for progressive delivery over a single connection before writing the Shell.
3. WHEN the Page_Server flushes the Shell, THE Shell SHALL contain one Placeholder for each pending Await_Block, each identified by its Await_Id.
4. WHILE at least one pending Await_Block has not settled, THE Page_Server SHALL keep the page response open.
5. WHEN every pending Await_Block for a page has settled and its Chunk has been written, THE Page_Server SHALL write the document tail and end the response.

### Requirement 4: Stream each settled await as a Chunk

**User Story:** As an end user, I want each awaited section to appear as soon as its data is ready, so that fast sections are not delayed by slow ones.

#### Acceptance Criteria

1. WHEN a pending Await_Block promise resolves, THE Page_Server SHALL write a Chunk containing the `{:then}` branch markup rendered with the resolved value and the Await_Id of the corresponding Placeholder.
2. IF a pending Await_Block promise rejects AND a `{:catch}` branch is present, THEN THE Page_Server SHALL write a Chunk containing the `{:catch}` branch markup rendered with the rejection reason and the Await_Id of the corresponding Placeholder.
3. IF a pending Await_Block promise rejects AND no `{:catch}` branch is present, THEN THE Page_Server SHALL write a Chunk that reports the error for the corresponding Await_Id without terminating the remaining pending Chunks.
4. WHEN multiple pending Await_Blocks settle, THE Page_Server SHALL write each Chunk in the order the promises settle rather than the order the Placeholders appear in the document.
5. WHEN the Page_Server renders a Chunk's branch markup, THE Chunk markup SHALL be byte-identical to the markup a non-streamed full render produces for the same settled value.

### Requirement 5: Swap Placeholders on the client as Chunks arrive

**User Story:** As an end user with JavaScript enabled, I want awaited sections to replace their loading placeholders in place, so that the page updates progressively without a full reload.

#### Acceptance Criteria

1. WHEN a Chunk arrives at the browser, THE Swap_Script SHALL replace the Placeholder content identified by the Chunk's Await_Id with the Chunk's settled markup.
2. WHEN the Swap_Script replaces a Placeholder, THE Swap_Script SHALL preserve the region anchors so that the Hydration_Runtime can claim the resulting DOM.
3. IF a Chunk's Await_Id does not match any Placeholder currently in the document, THEN THE Swap_Script SHALL leave the document unchanged for that Chunk.
4. WHEN all Chunks for a page have been swapped, THE resulting DOM SHALL be identical to the DOM produced by a non-streamed full render of the same page with the same settled values.

### Requirement 6: Hydrate the fully streamed page

**User Story:** As a Niral component author, I want the streamed page to hydrate into an interactive component, so that streaming does not break reactivity or event handling.

#### Acceptance Criteria

1. WHEN the Hydration_Runtime attaches to a fully streamed page, THE Hydration_Runtime SHALL claim the settled Await_Block DOM without rebuilding it.
2. WHILE one or more Await_Block Placeholders remain unsettled at hydration time, THE Hydration_Runtime SHALL treat each unsettled Placeholder as a pending Await_Block whose promise resolves on the client.
3. IF the Hydration_Runtime detects a mismatch between the streamed DOM and the client build, THEN THE Hydration_Runtime SHALL fall back to a clean client render of the affected region.
4. WHEN a streamed Await_Block has already settled server-side, THE Hydration_Runtime SHALL NOT re-fetch or re-evaluate that Await_Block's server-resolved value on the client.

### Requirement 7: Integrate streaming with `load()` and Stream_Mode opt-in

**User Story:** As a Niral component author, I want streaming to work with existing async `load()` loaders and route configuration, so that I can adopt streaming without rewriting my data layer.

#### Acceptance Criteria

1. WHERE Stream_Mode is enabled for a route, WHEN a `load()` loader returns a value containing a pending promise that a template Await_Block awaits, THE Streaming_Renderer SHALL flush the Shell before that promise settles.
2. WHERE Stream_Mode is not enabled for a route, WHEN the route contains an Await_Block, THE Page_Server SHALL render the page using the pre-existing non-streamed behavior.
3. WHEN the Page_Server serves a client-side navigation request that asks for JSON rather than HTML, THE Page_Server SHALL return the route payload using the pre-existing non-streamed navigation behavior.
4. WHERE Stream_Mode is enabled, WHEN the Page_Server has already flushed the Shell, THE Page_Server SHALL NOT set session cookies for that response after the first chunk is written.

### Requirement 8: Preserve framework hard constraints

**User Story:** As a framework maintainer, I want streaming SSR to preserve Niral's zero-dependency and server-isolation guarantees, so that the framework's core promises remain intact.

#### Acceptance Criteria

1. THE Niral_Framework `package.json` `dependencies` field SHALL remain empty after this feature is added.
2. THE Streaming_Renderer SHALL use only Node built-in modules and SHALL NOT introduce any new npm package.
3. WHEN the Compiler emits the client bundle for a streaming route, THE client bundle SHALL exclude all `<server>` block code and all String_Renderer helpers.
4. IF client code references `process.env`, THEN THE Compiler SHALL raise error NIRAL044 as it does before this feature.
5. THE Swap_Script SHALL contain only markup and instructions safe to run in the browser and SHALL NOT contain any `<server>` block source.

### Requirement 9: Handle streaming errors and connection loss

**User Story:** As an end user, I want a streamed page to degrade gracefully when an awaited section fails or the connection drops, so that a single failure does not corrupt the whole page.

#### Acceptance Criteria

1. IF a pending Await_Block promise rejects, THEN THE Page_Server SHALL continue writing Chunks for the remaining pending Await_Blocks.
2. IF the client connection closes before all Chunks are written, THEN THE Page_Server SHALL stop rendering remaining Await_Blocks and release the associated resources for that request.
3. WHEN a rejected Await_Block with no `{:catch}` branch is streamed, THE Page_Server SHALL report the error to the server error channel used by the pre-existing render path.
4. WHERE the Swap_Script receives a Chunk marked as an error for an Await_Id, THE Swap_Script SHALL render the error state for that Placeholder without affecting other Placeholders.
