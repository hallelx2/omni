# Architecture

Omni is built as a Bun workspace monorepo. This document describes how the
engine works, what the event surface looks like, and how each subsystem
plugs in.

## The engine, in one paragraph

`Engine.run(input)` is an **async generator**. It appends the user input to
conversation history, then loops: call the model, stream its events, append
the resulting assistant message, validate any tool calls it made, gate them
through the permission system, execute them in parallel, append the results,
and call the model again. The loop stops when the model returns no tool calls
(`model_done`), when iterations or retries are exhausted, when a loop is
detected, when an abort signal fires, or when a fatal error occurs. Every
observable thing is emitted as an `EngineEvent` — the engine never logs or
prints.

## Lifecycle

```
engine.start ─ (engine.iteration ─ model.* ─ tool.*)* ─ engine.done
```

Concrete sequence for a turn that calls one tool:

```
1.  engine.start          { sessionId, input }
2.  engine.iteration      { iteration: 1, maxIterations: 12 }
3.  model.start           { modelId }
4.  model.delta           { text: "I'll" }
5.  model.delta           { text: " run bash." }
6.  model.tool_call_done  { call: { id, name: "bash", args: {...} } }
7.  model.done            { finishReason: "tool_calls", usage }
8.  engine.usage          { delta, total }
9.  tool.permission_requested { call, tool: { name, description, permission } }
10. tool.permission_granted   { call }
11. tool.start            { call }
12. tool.result           { call, result, durationMs }
13. engine.iteration      { iteration: 2, maxIterations: 12 }
14. model.start           { modelId }
15. model.delta           { text: "Done." }
16. model.done            { finishReason: "stop", usage }
17. engine.usage          { delta, total }
18. engine.done           { reason: "model_done", usage, durationMs }
```

Parallel tool calls (when the model emits multiple in one turn) interleave
their events via `mergeStreams`.

## Event taxonomy

Twenty event types in three families:

**Engine lifecycle:**
`engine.start`, `engine.iteration`, `engine.done`, `engine.error`,
`engine.usage`, `engine.loop_detected`, `engine.retrying`, `engine.warning`.

**Model stream:**
`model.start`, `model.delta`, `model.thinking_delta`,
`model.tool_call_start`, `model.tool_call_args_delta`,
`model.tool_call_done`, `model.done`.

**Tool execution:**
`tool.permission_requested`, `tool.permission_granted`,
`tool.permission_denied`, `tool.invalid`, `tool.start`, `tool.progress`,
`tool.result`, `tool.error`.

Plus `context.compacted` when the context manager drops history to fit the
budget.

Every event is a discriminated union member of `EngineEvent`. UIs filter by
`event.type`.

## Subsystems

### Adapters (`@omni/adapters`)

Each adapter implements:

```ts
interface ModelAdapter {
  readonly id: string
  readonly name: string
  readonly capabilities: ModelCapabilities
  complete(params: CompleteParams): AsyncIterable<ModelEvent>
}
```

Adapters consume Omni's normalized `Message`/`ToolSchema` shape, translate to
the AI SDK 6 `ModelMessage` + tool format via `messagesToAISDK` and
`toolsToAISDK`, call `streamText`, then re-translate the AI SDK stream into
`ModelEvent` via `translateStream`. Costs are computed in a `withCost`
transform when the model's capabilities declare per-1k rates.

The `OpenAICompatibleAdapter` covers MiMo, Ollama, OpenRouter, vLLM,
LM Studio, Together, DeepInfra, etc. `mimo()` and `ollama()` are factory
helpers that preconfigure base URLs and per-model capability flags.

### Tools (`@omni/tools`)

Each tool implements:

```ts
interface Tool<TArgs, TResult> {
  readonly name: string
  readonly description: string
  readonly permission: "auto" | "ask" | "deny"
  readonly schema: z.ZodType<TArgs>
  execute(args: TArgs, ctx: ToolContext): Promise<TResult>
}
```

Built-ins: `bash`, `read_file`, `write_file`, `edit`, `multi_edit`, `glob`,
`grep`, `web_fetch`. The `MCPClient` wraps any Model Context Protocol server
(stdio or HTTP) so its tools register alongside built-ins.

The engine validates args against the Zod schema before invoking the tool.
Failed validation surfaces as `tool.invalid` with a precise error the model
can correct on its next turn.

### Permissions (`@omni/core/permissions`)

Pluggable gates: `AllowAllPermissions`, `DenyAllPermissions`,
`StaticPermissions`, `AskPermissions`, `RuleBasedPermissions`. Compose with
`AuditingPermissions` to log every decision to an `AuditLog`.

`looksDestructive(args)` is a built-in predicate that recognizes obvious
shell hazards (`rm -rf /`, fork bombs, `curl | sh`) for use as a `when`
predicate on bash deny rules.

### Context management (`@omni/core/context`)

`ContextManager` is an append-only message store with a pluggable
`ContextStrategy`. `SlidingWindowStrategy` keeps the most recent N messages;
`TokenBudgetStrategy` uses a `Tokenizer` (default `TiktokenTokenizer`) to fit
within a token budget while always preserving system messages. When a turn
drops messages, the engine emits `context.compacted`.

`chunkToolResult` truncates oversized tool results with a head/tail preview
so they don't drown a small model's window.

### The third brain (`@omni/improve`)

- **`Planner`** decomposes a user task into steps before the executor model
  sees it. Can use a stronger model than the executor.
- **`Critic`** reviews a transcript or tool result for plausibility. Returns
  `{ verdict, score, issues }` and `shouldRetry()` for retry decisions.
- **`Memory`** is a long-term fact/preference/skill store with linear-scan
  keyword recall (file-backed JSON; SQLite via `@omni/storage` is the future
  upgrade).

### Self-improvement (`@omni/improve`)

- **`probeModel`** sends a small battery of cheap prompts and returns a
  `ModelProfile`: native tool calls?, instruction-following?, verbose?,
  latency, error rate.
- **`adapt(profile)`** maps a profile to an `AdaptedStrategy`: which system
  prompt, whether to enable ReAct fallback, when to insert a planner/critic,
  output-token reserve.
- **`FileTracer`** writes every `EngineEvent` to a JSONL file (use as
  `EngineConfig.tracer`).
- **`scoreTrace`** ranks completed traces by outcome (model_done, low
  iterations, no errors, diverse tool use).
- **`replayTrace` + `checkTrace`** load a recorded trace and assert
  invariants — regression testing for agent behavior.
- **Variant pool** (`emptyPool`, `addVariant`, `recordTrial`,
  `tournamentSelect`, `mutatePrompt`) is a genetic-style prompt evolver. Run
  variants, score traces, retain winners, mutate them.

### Storage (`@omni/storage`)

`bun:sqlite` with versioned migrations (`_migrations` table). Seven
repositories: sessions, messages, events, audit, profiles, variants,
settings. Schemas use foreign keys with `ON DELETE CASCADE` so dropping a
session removes its messages and events atomically.

### Surfaces

- **`@omni/cli`** — interactive REPL with slash commands (`/help`, `/usage`,
  `/session`, `/quit`), readline-based permission prompts, ANSI rendering,
  session + event persistence to SQLite.
- **`@omni/server`** — HTTP + WebSocket. Each WS connection owns one engine
  instance. Protocol: client sends `{type:"run",input}` or `{type:"abort"}`;
  server streams `EngineEvent` JSON.
- **`@omni/web`** — single-page browser client that talks to the server.
- **`@omni/desktop`**, **`@omni/vscode`** — scaffolds. Plan: Tauri sidecar +
  WebView2 for desktop; VS Code WebView panel hosting the same web client
  bundle.

## Failure modes & safety

- **Loop detection.** When the same set of tool calls (`name + stableStringify(args)`)
  repeats 3 times in the last 5 turns, the engine emits
  `engine.loop_detected` and stops with `reason: "loop_detected"`.
- **Bounded retries.** Retryable model errors (rate limit, network, 5xx)
  retry inline within an iteration up to `maxRetriesPerIteration` (default 2).
  Retries do not consume iteration budget.
- **Abort propagation.** `engine.abort()` and `run({ signal })` both fire
  through `combineSignals` to every in-flight model call AND every tool's
  `ctx.signal`.
- **Permission gate exception.** If `permissions.check()` throws, the engine
  treats it as `deny` and emits `engine.warning` (category
  `"permission_gate"`).
- **Tracer exception.** If `tracer(event)` throws, it is disabled for the
  rest of the run and an `engine.warning` (`"tracer"`) is emitted.
- **Tool result chunking.** Tool results larger than 64KB are clipped to
  head + tail with an elision marker before being appended to history.

## Session snapshot/restore

`engine.snapshot()` returns `{ sessionId, messages, usage, createdAt,
updatedAt }`. `engine.restore(snap)` rehydrates a new engine instance to the
same state, preserving the original `sessionId` so traces continue under one
identity.

## Where to look in the source

- The loop: `packages/core/src/engine.ts`
- Event types: `packages/core/src/events.ts`
- Translation to/from AI SDK: `packages/adapters/src/util/*`
- Tool authoring contract: `packages/core/src/types.ts` (search for `Tool<`)
- Permissions: `packages/core/src/permissions.ts`
- Context strategies: `packages/core/src/context.ts`
