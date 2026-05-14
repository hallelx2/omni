# Omni

> A self-improving agent harness for open models.

Omni gives **any** language model — frontier or open, big or small — a body
to act through, a memory to learn from, and an evolving sense of how to use
itself. It was built for the open-model wave (MiMo, Qwen, GLM, DeepSeek,
Kimi, Llama via Ollama) but works just as well with Claude, GPT, and Gemini.

The thesis: weaker models become useful when the **harness around them is
strong**. Instead of asking a 7B model to plan, execute, and reflect on its
own, Omni layers in a planner, critic, and memory; probes the model on first
contact; and adapts its prompts, tools, and loop strategy to fit. The result
is an agent that punches above the model's weight class.

```
┌─ third brain ────────────┐   ┌─ hands ─────────────────┐   ┌─ super legs ────────────┐
│  Planner decomposes      │   │  bash, read/write,      │   │  Probe capabilities     │
│  Critic reviews          │ + │  edit (find/replace),   │ + │  Adapt prompts to model │
│  Memory recalls          │   │  multi_edit, glob,      │   │  Trace every session    │
│                          │   │  grep, web_fetch, MCP   │   │  Evolve prompt variants │
└──────────────────────────┘   └─────────────────────────┘   └─────────────────────────┘
                                          │
                                          ▼
                              ┌─────────────────────────┐
                              │  Engine (the loop)      │
                              │  AsyncIterable<Event>   │
                              └─────────────────────────┘
                                          │
        ┌──────────────────┬──────────────┴──────────────┬─────────────────┐
        ▼                  ▼                             ▼                 ▼
       CLI                Server                       Web              VS Code
   (readline)          (HTTP + WS)                  (browser)        (extension)
```

## Status

| | |
|---|---|
| **Tests** | 305 passing across 40 files |
| **Packages** | 11, all typecheck clean |
| **Source** | ~7,500 lines of TypeScript |
| **Models verified live** | MiMo-V2.5-Pro (full tool-use, reasoning_content roundtrip) |
| **Surfaces working** | CLI, HTTP/WS server, web client |
| **Surfaces scaffolded** | Desktop (Tauri plan), VS Code (extension plan) |

## What's in the box

| Package | Purpose |
|---|---|
| `@omni/core` | Engine loop, types, context, permissions, validator, tokenizer, paths/config |
| `@omni/adapters` | Model adapters via Vercel AI SDK 6: openai-compatible (MiMo, Ollama, OpenRouter…), Anthropic, OpenAI, Google + cost helper |
| `@omni/tools` | `bash`, `read_file`, `write_file`, `edit`, `multi_edit`, `glob`, `grep`, `web_fetch`, MCP client (stdio + HTTP) |
| `@omni/improve` | Planner, Critic, Memory, capability Probe (with cache), Adapt, FileTracer, score/replay traces, prompt-variant evolution |
| `@omni/storage` | `bun:sqlite` with versioned migrations + 7 repositories (sessions, messages, events, audit, model profiles, prompt variants, settings) |
| `@omni/cli` | Interactive terminal — slash commands, permission prompts, session persistence in `~/.omni/` |
| `@omni/server` | HTTP + WebSocket server with WS-bridged permission requests |
| `@omni/web` | Minimal browser client for the server |
| `@omni/desktop` | Tauri shell scaffold |
| `@omni/vscode` | VS Code extension scaffold |
| `@omni/cli-driver` | Tiny smoke-test driver |

## ~/.omni/ — your Omni home

Per-user state lives at `~/.omni/`:

```
~/.omni/
  config.json     # default adapter, model, provider keys, UI prefs
  db.sqlite       # sessions, messages, events, audit, profiles, variants, settings
  traces/         # one JSONL file per session run
  memory.json     # long-term memory entries
  settings.json   # surface-specific settings (theme, etc.)
```

Everything is overridable via env (`OMNI_HOME`, `OMNI_DB`, `OMNI_TRACES`,
`OMNI_MEMORY`, `OMNI_CONFIG`). The CLI's `/paths` command shows what
resolved.

### Example `~/.omni/config.json`

```json
{
  "adapter": "mimo",
  "model": "mimo-v2.5-pro",
  "maxIterations": 12,
  "enableReActFallback": true,
  "providers": {
    "mimo": {
      "apiKey": "tp-...",
      "baseURL": "https://token-plan-sgp.xiaomimimo.com/v1"
    },
    "anthropic": { "apiKey": "sk-ant-..." }
  },
  "permissions": {
    "mode": "ask",
    "denyDestructive": true
  },
  "ui": { "theme": "dark", "showThinking": true },
  "storage": { "tracesEnabled": true }
}
```

Precedence for every value: **explicit argument > env var > config file > built-in default**.

## Quick start

### 1. Install

```bash
git clone <your-fork> omni && cd omni
bun install
```

### 2. Configure a model

Pick one of the four routes:

**A. `~/.omni/config.json` (persistent, all surfaces)**

```bash
mkdir -p ~/.omni
cat > ~/.omni/config.json <<EOF
{
  "adapter": "mimo",
  "model": "mimo-v2.5-pro",
  "providers": { "mimo": { "apiKey": "tp-...", "baseURL": "https://token-plan-sgp.xiaomimimo.com/v1" } }
}
EOF
```

**B. workspace `.env` (per-checkout, dev-friendly)**

```bash
cat > .env <<EOF
MIMO_API_KEY=tp-...
MIMO_BASE_URL=https://token-plan-sgp.xiaomimimo.com/v1
OMNI_ADAPTER=mimo
EOF
```

**C. shell env (one-off run)**

```bash
OMNI_ADAPTER=mimo MIMO_API_KEY=tp-... bun run dev
```

**D. local model with Ollama (no key needed)**

```bash
ollama pull qwen2.5-coder:7b
OMNI_ADAPTER=ollama OMNI_MODEL=qwen2.5-coder:7b bun run dev
```

### 3. Run

```bash
bun run dev      # interactive CLI
bun run server   # HTTP + WS server on :8088
bun run web      # web client on :3000 (talks to embedded server)
bun test         # 305 tests
bun run typecheck  # all packages
```

### 4. Slash commands

In the CLI:

```
/help        list commands
/paths       show resolved ~/.omni/ paths
/usage       cumulative token usage and cost
/session     current session ID
/model       active model
/history     compact view of conversation so far
/quit        exit
```

## Provider matrix

| Adapter | Endpoint | Env var | Notes |
|---|---|---|---|
| `mimo` | `https://token-plan-sgp.xiaomimimo.com/v1` (configurable) | `MIMO_API_KEY` | Lower-case model ids: `mimo-v2.5-pro`, `mimo-v2.5`, `mimo-v2-flash`. Reasoning content auto-roundtripped. |
| `mimo-anthropic` | `<base>/anthropic/v1` | `MIMO_API_KEY` | Same key, Anthropic protocol. |
| `ollama` | `http://localhost:11434/v1` (configurable) | (none) | Any tag Ollama serves. |
| `anthropic` | api.anthropic.com | `ANTHROPIC_API_KEY` | Extended thinking supported. |
| `openai` | api.openai.com | `OPENAI_API_KEY` | gpt-4o, gpt-4o-mini, o1, o-series. |
| `google` | generativelanguage.googleapis.com | `GOOGLE_API_KEY` | gemini-2.0-flash, 1.5-pro. |
| `mock` | (none) | (none) | Scripted; for tests and offline dev. |

## What "self-improving" means here

Three concrete mechanisms, in increasing autonomy:

1. **Adaptive prompts.** On first contact with a model, Omni runs `probeModel`
   — a small battery of cheap prompts (~600 tokens) that classify the model
   along axes like native-tool-calls, instruction-following, verbosity.
   `adapt(profile)` returns a strategy: which system prompt, whether to
   enable ReAct fallback, max iterations, output reserve. The result is
   cached per model in `~/.omni/db.sqlite`.

2. **Session traces.** Every run writes a JSONL trace to `~/.omni/traces/`
   plus a row per event to SQLite. `scoreTrace` ranks completed sessions
   (model_done, low iteration count, no errors, diverse tool use).
   `replayTrace` + `checkTrace` re-run a trace against invariants — useful
   for regression-testing agent behavior.

3. **Prompt evolution.** A pool of system-prompt variants is maintained.
   `tournamentSelect` picks the best by mean trace score; `mutatePrompt`
   produces a child variant by edit-operation; trials accumulate. Over
   sessions, the prompts the model actually performs well with rise to the
   top. The pieces are built and unit-tested; wiring an evolution loop into
   the CLI is the next step.

The first mechanism is wired and live. Mechanisms 2 and 3 have the
infrastructure (tracer, repos, variant pool, scoring) but no autonomous
driver yet — that's a near-term project.

## Architecture

The engine is a closed-loop controller:

```
┌─────────────┐  tool call    ┌──────────────┐
│   Model     │──────────────▶│ Engine       │
│ (adapter)   │               │ - validate   │
│             │◀──────────────│ - permission │
└─────────────┘  result       │ - execute    │
                              │ - feed back  │
                              └──────┬───────┘
                                     │ events
                                     ▼
                            ┌──────────────────┐
                            │ EngineEvent      │
                            │ AsyncIterable    │
                            └──────────────────┘
```

See [docs/architecture.md](./docs/architecture.md) for the event taxonomy
(22 event types), lifecycle guarantees, and per-subsystem internals.

## Author guides

- [docs/authoring-a-tool.md](./docs/authoring-a-tool.md) — write a tool the
  model can use (contract, validation, progress events, anti-patterns).
- [docs/authoring-an-adapter.md](./docs/authoring-an-adapter.md) — plug in a
  new model provider (Vercel AI SDK translation utilities, provider-specific
  gotchas).

## Why this exists

Most agent frameworks assume frontier-grade models. The result is that they
crumble on local 7B–14B opens models that don't follow instructions as
crisply, hallucinate tool names, miss formatting, or stop responding
mid-tool-call. Omni's bet: by **probing** what each model actually does,
**adapting** the loop to compensate, and learning **across** sessions, a
small open model running on your laptop can do real work.

There are also philosophical reasons. A harness is the **body** of an agent:
it determines what the model can perceive (observation space), what it can
do (action space), and what persists (state). Building one is the highest-
leverage thing you can do to make a model useful — and the work is portable
across whatever model comes next.

## Status of each aspect (as of last commit)

| Aspect | Done | Honest debt |
|---|---|---|
| 1. Core engine | ✅ streaming, abort, loops, retries, parallel calls, snapshot, tracer | engine.ts ~440 lines (could split); no property test for "aborted runs never emit tool.result" |
| 2. Types & API | ✅ TSDoc, JSONSchema7, tiered exports, TypeDoc, 11 expect-type assertions | no `@internal` build-time enforcement |
| 3. Adapters | ✅ 7 providers, reasoning roundtrip, cost compute, fake-fetch e2e | rate-limit retry untested live; Google adapter not run end-to-end |
| 4. Tools | ✅ bash (ANSI-stripped), edit + multi_edit, glob, grep (rg-accelerated), web_fetch (markdown), MCP stdio + in-memory tested | no `apply_patch` (unified diff) tool; web_fetch turndown untested for complex layouts |
| 5. Context | ✅ tiktoken, TokenBudgetStrategy, tool-result chunking, compaction events | no summarization-based compaction yet; no semantic recall |
| 6. Permissions | ✅ 4 gate types, rule patterns, destructive predicate, audit log | no allowlist-default mode; no per-path bash restrictions |
| 7. Third brain | ✅ Planner, Critic, Memory unit-tested | Memory uses keyword scan, no embeddings |
| 8. Self-improvement | ✅ probe (cached), adapt, FileTracer, scoreTrace, replay + check, variant pool | not yet auto-wired into CLI flow |
| 9. Storage | ✅ versioned migrations, 7 repos, FK cascades | no backup/restore command; forward-only migrations |
| 10. CLI | ✅ interactive REPL, slash commands incl. `/paths`, sessions persisted | uses readline not opentui (deferred); slash args space-split (no quoted strings) |
| 11. Surfaces | ✅ server WS with permission forwarding; web client | desktop/vscode are scaffolds; web uses window.confirm |
| 12. Testing | ✅ typecheck script, CI workflow, replay + check, 4 property tests | no load test; no chaos/fuzz on adapter translation |
| 13. Documentation | ✅ README, architecture, 2 author guides, .env.example | no `examples/` directory yet; no FAQ |

## License

MIT.
