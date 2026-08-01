# Pi child-session and extension APIs

**Research ticket:** [Research Pi public child-session and extension APIs](https://github.com/simonteague6/pi-engineering-toolkit/issues/5)

**Observed Pi version:** `@earendil-works/pi-coding-agent` `0.82.1` (installed locally; released 2026-07-25)

## Decision

For the v1 subagent extension, use **one-shot subprocesses as the primary execution boundary**:

```text
pi --mode json -p --no-session [model/tool options] <prompt>
```

The parent extension should parse the child JSON event stream, forward bounded progress through the tool's `onUpdate`, collect the final assistant message, and translate process exit, abort, and provider errors into structured results. This is the same boundary used by Pi's official subagent example and gives each child an isolated process, context window, session, cwd, resource discovery, and failure boundary.

Keep the **in-process SDK** as an explicit advanced seam, not the default v1 runner. Use it when a caller needs direct typed state or lower overhead and can accept shared-process failure/resource coupling. Use **RPC** for a later long-lived child-job mode that needs steering, follow-ups, state queries, or an interactive lifecycle; use the exported `RpcClient` rather than inventing a second protocol.

## Public execution seams

### 1. One-shot JSON subprocess — v1 default

Pi's JSON mode emits `AgentSessionEvent` values as JSON lines. It includes `agent_start`, `agent_end`, `turn_start`/`turn_end`, message lifecycle events, tool execution lifecycle events, queue events, compaction/retry events, and (in the current API) `agent_settled`.

The official `examples/extensions/subagent` implementation uses `node:child_process.spawn()` with:

- `--mode json -p --no-session`
- optional `--model <definition>`
- optional `--tools <comma-separated allowlist>`
- a temporary file passed through `--append-system-prompt` for the delegated agent definition
- `cwd` set per task
- stdout JSON-line parsing and stderr collection
- `SIGTERM`, followed by `SIGKILL` after a grace period, on abort

That example is the closest first-party reference for this package's intended use case. Its isolated subprocess is also a clean context boundary: the child does not inherit the parent's conversation messages, session manager, extension instance, or in-memory state.

**Important:** `agent_end` is not necessarily final. Pi may retry, compact and retry, or deliver queued follow-ups after it. Treat `agent_settled` as the completion signal when consuming a live stream. For a one-shot process, also require process exit and preserve the final assistant message/stop reason.

### 2. In-process SDK — supported, but coupled

The public SDK exports:

```ts
import {
  createAgentSession,
  createAgentSessionRuntime,
  createAgentSessionServices,
  createAgentSessionFromServices,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
```

The minimum direct child flow is:

```ts
const modelRuntime = await ModelRuntime.create();
const { session } = await createAgentSession({
  cwd,
  model,
  modelRuntime,
  sessionManager: SessionManager.inMemory(cwd),
  tools: ["read", "bash"],
});

const unsubscribe = session.subscribe((event) => {
  // message_update, tool_execution_*, agent_*, retry/compaction events, etc.
});

try {
  await session.prompt(prompt);
} finally {
  unsubscribe();
  session.dispose();
}
```

`AgentSession` provides direct lifecycle control: `prompt`, `steer`, `followUp`, `subscribe`, `abort`, `waitForIdle`, `setModel`, `setThinkingLevel`, `messages`, `isStreaming`, `getSessionStats`, and `dispose`.

Use `SessionManager.inMemory(cwd)` for an ephemeral child. Use `SessionManager.create(cwd)` only when the child session itself is a deliberate durable artifact. `createAgentSession()` does **not** provide a special parent/child session relationship; the package must define that relationship in its own result metadata.

`createAgentSessionRuntime()`/`AgentSessionRuntime` is the public seam for replacing sessions (`newSession`, `switchSession`, `fork`, and import) and for rebuilding cwd-bound services. It is not needed for a single bounded child run. If used, callers must rebind subscriptions and extension bindings after replacement because `runtime.session` changes and old session-bound objects become stale.

#### In-process extension loading

`createAgentSession()` returns `extensionsResult` for host setup, but the session's extension runtime must be bound with `session.bindExtensions(...)` before relying on extension lifecycle/UI behavior. A child should either:

1. run with a deliberately minimal `ResourceLoader` and no child extensions, or
2. explicitly bind a child extension runtime with the correct `mode`, UI context, command actions, shutdown handler, and error handler.

Do not assume the parent's `ExtensionAPI` instance or `pi.events` bus crosses into the child automatically. A shared `eventBus` can connect separately-created in-process loaders when deliberately passed to them; it cannot cross a subprocess boundary. The v1 parent should translate child events into its own extension/tool updates rather than expose the child's extension runtime directly.

### 3. RPC subprocess — later long-lived mode

RPC mode is a strict LF-delimited JSONL command/event protocol. The public package exports `RpcClient`, which owns process startup, request correlation, event listeners, stderr capture, and commands including:

- `prompt`, `steer`, `followUp`, `abort`
- `waitForIdle`, `collectEvents`, `promptAndWait`
- `getState`, `getMessages`, `getEntries`, `getTree`, `getSessionStats`
- model/thinking controls
- `newSession`, `switchSession`, `fork`, `clone`
- `bash`, compaction, retry, and shutdown-related controls

RPC is the correct public seam when a child remains alive across multiple prompts or needs host-directed steering and state inspection. It is more protocol-heavy than JSON one-shot mode and should not be the default for a bounded subagent invocation.

RPC clients must split records on `\n` only, optionally strip a trailing `\r`, and must not use Node's generic `readline` semantics because Pi permits Unicode line-separator characters inside JSON strings. Correlate commands with their optional `id`; correlate tool progress with `toolCallId`.

## Model configuration and authentication

`ModelRuntime` is the current canonical model/auth facade. It resolves built-in and custom models, credentials, provider auth, model availability, and provider request configuration. Relevant methods include `ModelRuntime.create()`, `getModel()`, `getAvailable()`, `getAuth()`, `setRuntimeApiKey()`, and provider registration methods.

A child should receive an explicit model/profile from the parent when deterministic delegation matters. Passing a model object alone does not bypass authentication: `session.prompt()` validates that a model and usable auth are available. Prefer one shared `ModelRuntime` for in-process children when the parent owns credential/model configuration; subprocess children inherit normal Pi configuration unless the parent passes explicit CLI model/auth/environment options.

Pi `0.80.8` made a breaking SDK change from `authStorage`/`modelRegistry` to the async `modelRuntime` option. Pi `0.80.4` added public SDK model resolution and `agent_settled`; the current `0.82.1` package requires Node `>=22.19.0`.

**Package constraint:** the extension currently declares Pi peers as `*`, which is too loose for this API surface. v1 should declare and test a minimum compatible Pi version of **`>=0.80.8`**, and the package should keep a compatibility adapter or release policy if it must support older Pi versions. Because Pi is still `0.x` and has made minor-version breaking changes, compatibility should be tested against the exact supported versions rather than inferred from semver alone. The package should also document the Node engine requirement inherited from the supported Pi release.

## Tools and context boundaries

Both SDK and CLI paths support explicit tool control:

- CLI: `--tools read,bash` or `--no-tools`/`--no-builtin-tools`
- SDK: `tools`, `noTools`, `excludeTools`, and `customTools`
- SDK custom cwd: pass `cwd` and use a cwd-bound `SessionManager`

The v1 runner should not silently give children the parent's full active tool set. The agent definition/profile should resolve an allowlist, and the runner should record the effective cwd, model, thinking level, tool allowlist, and session mode in its result metadata.

Pi project trust is not a sandbox. Extensions, built-in tools, and child processes run with the parent user's OS permissions. Non-interactive modes do not show a trust prompt; project-local resources are controlled by saved trust/default settings or explicit approval flags. Real isolation requires a container, VM, micro-VM, or other OS-level boundary. The v1 package should expose safe tool configuration but leave OS sandboxing as the later integration noted on the map.

## Failure and lifecycle contract for the package

The runner should make these boundaries explicit:

1. **Startup failure:** executable missing, invalid arguments, model unavailable, auth unavailable, resource-load failure, or child spawn error.
2. **Stream failure:** malformed JSON, unexpected EOF, child stderr output, or a provider/agent error event.
3. **Execution failure:** tool result with `isError`, assistant `stopReason: "error"`, non-zero exit, or an aborted child.
4. **Cancellation:** abort the child through the supplied `AbortSignal`; send `SIGTERM`, then force-kill after a bounded grace period, and report `aborted` distinctly from ordinary failure.
5. **Completion:** do not declare success from a partial text delta or `agent_end`; collect the terminal assistant message and wait for `agent_settled`/clean process exit.
6. **Output bound:** preserve a bounded in-memory progress/result representation. Pi's built-in tool output limit is 50 KB or 2,000 lines, and the official subagent example caps each parallel result at 50 KB. Full output, if retained, belongs in a file asset rather than an unbounded tool result.
7. **Parallelism:** the official example limits a request to eight parallel tasks and four concurrent child processes. Those are package policy defaults, not Pi runtime guarantees, and should be configurable only within a deliberate resource budget.
8. **Cleanup:** every child process, event subscription, temporary prompt file, and RPC client must be cleaned up on success, failure, abort, and session shutdown. Extension startup must not create long-lived background resources before `session_start` or an explicit command/tool invocation.

The child result should therefore distinguish at least `completed`, `failed`, `aborted`, and `startup_failed`, and include final text, structured event summary, model/provider, usage where available, exit/error details, and any persisted artifact path.

## Recommended v1 seam

Implement a small runner abstraction behind the future extension tool:

```text
ChildRunner
  run(request, signal, onEvent) -> Promise<ChildResult>

  SubprocessJsonRunner  [default: single/parallel/chain]
  RpcRunner             [future: persistent jobs and steering]
  InProcessSdkRunner    [future/explicit opt-in]
```

Keep the extension responsible for orchestration, claiming model/tool/cwd policy, cancellation, bounded rendering, and mapping child lifecycle into `pi.events`/`onUpdate`. Keep Pi's skills responsible for what the delegated task means and what counts as a valid result. Do not make the runner a planner or duplicate skill judgment in its prompts.

## Sources

- [Pi SDK documentation](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)
- [Pi RPC documentation](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/rpc.md)
- [Pi JSON event stream documentation](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/json.md)
- [Pi extension documentation](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [Official subagent extension example](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent/examples/extensions/subagent)
- [Pi security model](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/security.md)
- [Pi package on npm](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
- [Pi changelog: 0.80.4, 0.80.8, 0.82.1](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/CHANGELOG.md)
