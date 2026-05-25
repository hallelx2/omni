<div align="center">

```
 ██████╗ ███╗   ███╗███╗   ██╗██╗
██╔═══██╗████╗ ████║████╗  ██║██║
██║   ██║██╔████╔██║██╔██╗ ██║██║
██║   ██║██║╚██╔╝██║██║╚██╗██║██║
╚██████╔╝██║ ╚═╝ ██║██║ ╚████║██║
 ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═══╝╚═╝
```

### A self-improving agent harness for open models

*Brain, hands, and super legs for any LLM — frontier or local.*

[![CI](https://github.com/hallelx2/omni/actions/workflows/ci.yml/badge.svg)](https://github.com/hallelx2/omni/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](#license)
[![Bun](https://img.shields.io/badge/bun-1.2+-000000?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-305%20passing-brightgreen)](#status)
[![Status](https://img.shields.io/badge/status-pre--alpha-orange)](#status)

[**Quick start**](#-quick-start) •
[**Docs**](./docs/architecture.md) •
[**Authoring guides**](#-extending-omni) •
[**Roadmap**](#-roadmap--honest-debt)

</div>

---

Omni gives **any** language model — frontier or open, big or small — a body to act through, a memory to learn from, and an evolving sense of how to use itself. It was designed for the open-model wave (MiMo, Qwen, GLM, DeepSeek, Kimi, Llama via Ollama) and works just as well with Claude, GPT, and Gemini.

The thesis is simple: **weaker models become useful when the harness around them is strong.** Instead of asking a 7B model to plan, execute, and reflect on its own, Omni layers in a planner, a critic, and a memory; probes the model on first contact; and adapts its prompts, tools, and loop strategy to fit. The result is an agent that punches above the model's weight class.

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

---

## ✨ Why Omni

Most agent frameworks assume a frontier model. Run them on a local 7B and they crumble — the model hallucinates tool names, drops formatting, goes in circles. The convenient answer is to wait for open models to catch up. Omni takes the other route:

> The model is interchangeable. The harness *is* the agent.

If the harness compensates intelligently for what the model can't do — by probing capabilities, choosing the right system prompt, decomposing tasks, criticising results, and learning across sessions — then a 7B running on your laptop can do real work.

---

## 🎯 Features

<table>
<tr>
<td width="50%" valign="top">

### 🧠 Third Brain
- **Planner** decomposes user tasks before execution
- **Critic** reviews assistant turns and tool results
- **Memory** persists facts, preferences, and skills across sessions

### ✋ Hands
- `bash` (cross-platform: bash/pwsh, ANSI-stripped, 256KB cap)
- `read_file`, `write_file` with size limits and slicing
- `edit` (find/replace, ambiguity-safe) + `multi_edit` (atomic)
- `glob` (Bun.Glob, mtime-sorted) + `grep` (rg-accelerated)
- `web_fetch` (HTML→markdown via turndown)
- **MCP client** for any Model Context Protocol server

</td>
<td width="50%" valign="top">

### 🦵 Super Legs (self-improvement)
- **Probe** classifies a model on first contact (~600 tokens)
- **Adapt** picks system prompt, ReAct fallback, iteration budget
- **Traces** persist every session as JSONL + SQLite
- **Evolve** mutates prompt variants and ranks by trace fitness

### 🔌 Surfaces
- Interactive **CLI** (readline, slash commands, sessions)
- **HTTP + WebSocket server** with permission forwarding
- **Browser client** (minimal vanilla HTML/TS)
- Scaffolds for **Tauri desktop** and **VS Code** extension

</td>
</tr>
</table>

### 🤖 Subagents & Modes

- **Prebuilt subagents** — `explore`, `test`, `critique` ship in-repo as `AGENT.md` definitions, each a sandboxed child engine with its own model, tool subset, and **enforced** permission rules (regex allow/deny per tool — e.g. `test` may run `bun test` but not `rm -rf`, and write only `*.test.ts`). Override or add your own in `~/.omni/agents/<name>/AGENT.md` or workspace `.omni/agents/`.
- **Parallel dispatch** — the agent calls a subagent directly as a tool, or fans several out at once with `dispatch_agents` (bounded concurrency, partial-failure isolation, abort propagation) and collects every result when they finish.
- **Plan / Build modes** — `plan` restricts the main engine to read-only tools and runs the **Planner** first; `build` allows all tools and runs the **Critic** after each turn. Switch with `/plan` · `/build` · `/mode`; the agent can request a plan→build switch via `request_build_mode` (human-gated).
- **Per-role models** — the planner, critic, and each subagent may run on a different model than the main agent (e.g. plan on Claude, execute on a local model), defaulting to the main model.

### Engine guarantees

True streaming • abort propagation through model + tools • loop detection by tool-call signature • bounded retries on retryable errors • parallel tool calls with interleaved event streams • session snapshot/restore preserving identity • cost tracking when per-1k rates are known • 22 discriminated `EngineEvent` variants — the only public observation channel.

---

## 🚀 Install

**One-liner** (downloads the prebuilt binary, installs to `~/.omni/bin`, wires PATH):

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/hallelx2/omni/main/install.sh | bash
```
```powershell
# Windows (PowerShell)
irm https://raw.githubusercontent.com/hallelx2/omni/main/install.ps1 | iex
```

Then drop your key in `~/.omni/.env` and run `omni`:

```bash
echo 'MIMO_API_KEY=tp-...' >> ~/.omni/.env
omni                  # full TUI
omni --plain          # plain readline REPL (pipes / CI)
```

With `MIMO_API_KEY` present, Omni auto-selects the MiMo adapter — no
`OMNI_ADAPTER` needed.

### Build & install from source

```bash
git clone https://github.com/hallelx2/omni.git && cd omni
bun install
bun run setup         # build host binary → ~/.omni/bin/omni + wire PATH
```

Or just build without installing:

```bash
bun run build         # → packages/cli/dist/omni[.exe]  (host platform)
bun run build:all     # all platforms (win/linux/mac × x64/arm64)
```

### Run from source (no build)

```bash
bun run dev           # interactive TUI
OMNI_ADAPTER=mimo bun run dev
bun run dev --plain   # readline REPL
bun test              # test suite
bun run typecheck     # all packages
```

### Publish a release

**GitHub release (binaries for the `curl | bash` installers):**

```bash
gh auth login
bun run release v0.1.0   # build:all + create GitHub release with binaries
```

This uploads assets named `omni-<plat>-<arch>` so the install one-liners
above can fetch them.

**npm release (all platforms, via CI):** push a tag and the
[`Release (npm)`](./.github/workflows/release.yml) workflow builds a native
binary on a runner per OS, then publishes the `omni-harness` launcher plus
each `omni-harness-<plat>` package. Cross-compiling can't be done from one
host (opentui ships per-platform native modules), so the matrix is required.

```bash
git tag v0.1.0-beta.1 && git push origin v0.1.0-beta.1   # → npm tag "beta"
git tag v0.1.0        && git push origin v0.1.0           # → npm tag "latest"
# or run the workflow manually (Actions → Release (npm) → Run workflow)
```

Testers then install with:

```bash
npm i -g omni-harness@beta   # or @latest
omni
```

**One-time setup:** add an npm automation token as the repo secret
`NPM_TOKEN` (Settings → Secrets → Actions). The Linux-arm64 leg uses the
`ubuntu-24.04-arm` runner (GitHub-hosted arm64; available on public repos).

---

## ⚙ Configuration: `~/.omni/`

Omni keeps per-user state in `~/.omni/`:

```
~/.omni/
├── config.json     # default adapter, model, provider keys, UI prefs
├── db.sqlite       # sessions, messages, events, audit, profiles, variants
├── traces/         # one JSONL file per session run
├── agents/         # custom subagent defs (AGENT.md) — override the shipped ones
├── memory.json     # long-term memory entries
└── settings.json   # surface-specific settings (theme, etc.)
```

Every path is env-overridable (`OMNI_HOME`, `OMNI_DB`, `OMNI_TRACES`, `OMNI_MEMORY`, `OMNI_CONFIG`). The CLI's `/paths` command shows what resolved.

<details>
<summary><b>Example <code>~/.omni/config.json</code></b></summary>

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
  "storage": { "tracesEnabled": true },
  "modes": { "default": "build" },
  "agents": {
    "planner": { "model": "anthropic:claude-sonnet-4-5" },
    "critic": { "enabled": true, "autoRetry": false }
  }
}
```

</details>

**Precedence for every value:** explicit argument **>** env var **>** config file **>** built-in default.

---

## 🔌 Provider matrix

| Adapter | Endpoint | Env var | Notes |
|---|---|---|---|
| `mimo` | `https://token-plan-sgp.xiaomimimo.com/v1` | `MIMO_API_KEY` | Lowercase model ids (`mimo-v2.5-pro`); reasoning content auto-roundtripped |
| `mimo-anthropic` | `<base>/anthropic/v1` | `MIMO_API_KEY` | Same key, Anthropic protocol |
| `ollama` | `http://localhost:11434/v1` | *(none)* | Any tag Ollama serves locally |
| `anthropic` | api.anthropic.com | `ANTHROPIC_API_KEY` | Extended thinking supported |
| `openai` | api.openai.com | `OPENAI_API_KEY` | gpt-4o, gpt-4o-mini, o1, o-series |
| `google` | generativelanguage.googleapis.com | `GOOGLE_API_KEY` | gemini-2.0-flash, 1.5-pro |
| `mock` | *(none)* | *(none)* | Scripted; for tests and offline dev |

All non-mock adapters go through **Vercel AI SDK 6**. Adding a new provider is roughly 80 lines — see [`docs/authoring-an-adapter.md`](./docs/authoring-an-adapter.md).

---

## 📚 Slash commands (in the CLI)

```
/help         list commands
/paths        show resolved ~/.omni/ paths
/usage        cumulative token usage and cost
/session      current session ID
/model        active model
/mode         show or switch run mode (/mode plan | /mode build)
/plan         switch to plan mode (read-only + planner)
/build        switch to build mode (full tools + critic)
/skill        pin/unpin a skill (/skill <name|off>)
/history      compact view of conversation so far
/quit         exit (also: /exit)
```

---

## 🧪 What "self-improving" actually means

Three concrete mechanisms, in increasing autonomy:

**1. Adaptive prompts.** On first contact with a model, Omni runs `probeModel` — a small battery of cheap prompts (~600 tokens) that classify the model along axes like *native tool calls?*, *instruction-following?*, *verbosity?*. `adapt(profile)` returns a strategy: which system prompt, whether to enable ReAct fallback, max iterations, output reserve. Results are cached per model in `~/.omni/db.sqlite`.

**2. Session traces.** Every run writes a JSONL trace to `~/.omni/traces/` plus rows to SQLite. `scoreTrace` ranks completed sessions (model_done, low iteration count, no errors, diverse tool use). `replayTrace` + `checkTrace` re-run a trace against invariants — regression testing for agent behavior.

**3. Prompt evolution.** A pool of system-prompt variants is maintained in SQLite. `tournamentSelect` picks the best by mean trace score; `mutatePrompt` produces a child variant. Over sessions, the prompts that actually perform rise to the top. *Infrastructure built and tested; CLI driver wiring is the next sprint.*

---

## 🏗 Architecture

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

See [docs/architecture.md](./docs/architecture.md) for the full event taxonomy (22 types), lifecycle guarantees, and per-subsystem internals.

---

## 📦 Packages

| Package | Purpose |
|---|---|
| [`@omni/core`](./packages/core) | Engine loop, types, context, permissions, validator, tokenizer, paths/config |
| [`@omni/adapters`](./packages/adapters) | Vercel AI SDK adapters — openai-compatible (MiMo, Ollama…), Anthropic, OpenAI, Google + cost helper |
| [`@omni/tools`](./packages/tools) | `bash`, `read_file`, `write_file`, `edit`, `multi_edit`, `glob`, `grep`, `web_fetch`, MCP client |
| [`@omni/improve`](./packages/improve) | Planner, Critic, Memory, Probe, Adapt, FileTracer, replay, prompt evolution |
| [`@omni/storage`](./packages/storage) | `bun:sqlite` with versioned migrations + 7 repositories |
| [`@omni/cli`](./packages/cli) | Interactive terminal — slash commands, permission prompts, session persistence |
| [`@omni/server`](./packages/server) | HTTP + WebSocket server with WS-bridged permission requests |
| [`@omni/web`](./packages/web) | Minimal browser client |
| [`@omni/desktop`](./packages/desktop) | Tauri shell *(scaffold)* |
| [`@omni/vscode`](./packages/vscode) | VS Code extension *(scaffold)* |
| [`@omni/cli-driver`](./packages/cli-driver) | Smoke-test driver |

---

## 🛠 Extending Omni

- **[Authoring a tool](./docs/authoring-a-tool.md)** — write a tool the model can use (contract, schemas, progress events, anti-patterns)
- **[Authoring an adapter](./docs/authoring-an-adapter.md)** — plug in a new model provider (translation utilities, provider-specific gotchas)
- **[Architecture](./docs/architecture.md)** — engine internals, event taxonomy, lifecycle
- **API reference** — generated with `bun run --cwd packages/core docs` (TypeDoc)

A minimal tool looks like this:

```ts
import { z } from "zod"
import type { Tool, ToolContext } from "@omni/core"

export const shout: Tool<{ text: string }, { result: string }> = {
  name: "shout",
  description: "Return the input in upper case.",
  permission: "auto",
  schema: z.object({ text: z.string() }),
  async execute(args, ctx: ToolContext) {
    return { result: args.text.toUpperCase() }
  },
}
```

---

## 📊 Status

| | |
|---|---|
| **Tests** | 305 passing across 40 files |
| **Packages** | 11, all typecheck clean |
| **Source** | ~7,500 lines of TypeScript |
| **Verified live** | MiMo-V2.5-Pro (full tool-use, reasoning_content roundtrip) |
| **Working surfaces** | CLI, HTTP/WS server, web client |
| **Scaffolded** | Desktop (Tauri plan), VS Code (extension plan) |

---

## 🗺 Roadmap & honest debt

<details>
<summary><b>What's solid (click to expand)</b></summary>

| Aspect | Done |
|---|---|
| **1. Engine** | streaming, abort, loops, retries, parallel tools, snapshot, tracer hook, 4 fuzz-style property tests |
| **2. Types & API** | TSDoc on every public symbol, JSONSchema7 for tool params, tiered exports, TypeDoc generates clean docs |
| **3. Adapters** | 7 providers via Vercel AI SDK 6, reasoning_content roundtrip, cost computation, fake-fetch e2e tests |
| **4. Tools** | 8 built-ins + MCP (in-memory + real stdio tested), cross-platform shell with ANSI strip, path safety |
| **5. Context** | tiktoken tokenizer, TokenBudgetStrategy, tool-result chunking, `context.compacted` events |
| **6. Permissions** | 4 gate types + audit + rule patterns + `looksDestructive` predicate |
| **7. Third brain** | Planner, Critic, Memory all unit-tested |
| **8. Self-improvement** | probe (cached), adapt, FileTracer, scoreTrace, replay + checkTrace, variant pool |
| **9. Storage** | bun:sqlite, versioned migrations, 7 repos, FK cascades |
| **10. CLI** | interactive REPL, slash commands, session/event persistence |
| **11. Surfaces** | server WS with permission forwarding tested 3 ways; web client with permission UI |
| **12. Testing** | typecheck script, CI workflow, trace replay, 4 property tests |
| **13. Documentation** | architecture + 2 author guides + .env.example + TypeDoc |

</details>

<details>
<summary><b>What's still imperfect (the honest list)</b></summary>

- **Engine** — `engine.ts` is ~440 lines (could split executor); no property test proving aborted runs never emit `tool.result`
- **Adapters** — rate-limit retry untested live; Google adapter not run end-to-end; Anthropic extended thinking not e2e-verified
- **Tools** — `grep` ripgrep path covered only when `rg` happens to be installed during the test run; `web_fetch` markdown untested for complex layouts
- **Context** — `SummarizingStrategy` exists but the wired default is still `TokenBudgetStrategy` (drops messages, doesn't summarize); no semantic recall in the loop; one tokenizer for all models (should be per-adapter)
- **Permissions** — destructive bash is now denied by default on the main engine, with opt-in workspace confinement (`restrictToWorkspace`) and an `allowlistGate` preset; the bash path-confinement is heuristic, not a true per-command sandbox
- **Third brain** — `VectorMemory` (embedding recall) exists but isn't wired into the loop yet; the base `Memory` is linear-scan keyword recall
- **Self-improvement** — probe/adapt/evolve are *built* but not yet *wired into* the CLI flow as the default loop
- **Storage** — no backup/restore command; forward-only migrations
- **CLI** — slash arg parsing is space-split (no quoted strings); no `/sessions` continue command yet
- **Surfaces** — desktop and vscode are scaffolds (architecture plans in their `index.ts`); web uses `window.confirm` for permissions
- **Testing** — no load test; no chaos/fuzz on adapter translation layer
- **Docs** — no `examples/` directory; no FAQ

</details>

---

## 🤝 Contributing

Issues and PRs welcome. The workflow is straightforward:

```bash
bun install
bun test               # ensure baseline is green
# ... make changes
bun run typecheck      # all packages
bun test
```

A few conventions: tools belong in `@omni/tools` and follow the `Tool<TArgs, TResult>` contract; new model providers belong in `@omni/adapters` and use the AI SDK translation helpers; never throw from a permission gate (return deny); every public symbol gets a TSDoc comment.

---

## 🙏 Acknowledgments

Omni stands on the shoulders of:

- [**Vercel AI SDK**](https://github.com/vercel/ai) — provider translation, streaming, tool calling
- [**Bun**](https://bun.sh) — runtime, package manager, SQLite, test runner, all of it
- [**opencode**](https://github.com/sst/opencode) — studied for monorepo structure and the `reasoning_content` roundtrip pattern
- [**Model Context Protocol**](https://modelcontextprotocol.io) — the standard for extending agents with external tools
- [**ripgrep**](https://github.com/BurntSushi/ripgrep) — accelerates `grep` when present
- [**Xiaomi MiMo**](https://platform.xiaomimimo.com) — the model that proved this approach on a real open weights stack

---

## 📄 License

[MIT](./LICENSE) © Halleluyah Oludele

<div align="center">
<sub>Built with care. Designed to outlast whatever model comes next.</sub>
</div>
