#!/usr/bin/env bun
/**
 * Tiny end-to-end driver for exercising the engine + adapters from the CLI.
 *
 * Picks an adapter from (in order of precedence): env > config > default.
 *   - OMNI_ADAPTER=mock       (default) — scripted MockAdapter
 *   - OMNI_ADAPTER=mimo       — needs MIMO_API_KEY (+ optional OMNI_MODEL)
 *   - OMNI_ADAPTER=mimo-anthropic — MiMo via its Anthropic-compatible endpoint
 *   - OMNI_ADAPTER=ollama     — needs OMNI_MODEL (e.g. "qwen2.5-coder:7b")
 *   - OMNI_ADAPTER=anthropic  — needs ANTHROPIC_API_KEY (+ OMNI_MODEL)
 *   - OMNI_ADAPTER=openai     — needs OPENAI_API_KEY (+ OMNI_MODEL)
 *   - OMNI_ADAPTER=google     — needs GOOGLE_API_KEY (+ OMNI_MODEL)
 *
 * Usage:
 *   bun run packages/cli/src/bin.ts                # interactive REPL
 *
 * `.env` at the workspace root is loaded explicitly here so its values
 * override any stale variables already set in the shell. Per-user config
 * lives at `~/.omni/config.json`; see `omniPaths()`.
 */
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { mkdirSync } from "node:fs"
import readline from "node:readline"
import {
  Engine,
  AskPermissions,
  TokenBudgetStrategy,
  ContextManager,
  TiktokenTokenizer,
  AuditingPermissions,
  loadMergedConfig,
  ensureOmniHome,
  omniPaths,
  workspacePaths,
  resolveApiKey,
  resolveBaseURL,
  type ModelAdapter,
  type Tool,
  type Config,
} from "@omni/core"
import {
  MockAdapter,
  type MockScript,
  mimo,
  ollama,
  AnthropicAdapter,
  OpenAIAdapter,
  GoogleAdapter,
} from "@omni/adapters"
import { bash, readFile, writeFile, edit, multiEdit, glob, grep, webFetch, MCPManager } from "@omni/tools"
import { Storage, SessionsRepo, MessagesRepo, EventsRepo, AuditRepo, ProfilesRepo } from "@omni/storage"
import {
  FileTracer,
  SqliteProfileCache,
  probeModelCached,
  adapt,
  loadSkills,
  findMatchingSkill,
  filterToolsBySkill,
  setFrontmatterParser,
  type Skill,
} from "@omni/improve"
import { parseFrontmatter } from "./user-commands.ts"
import { loadHooks } from "./hook-loader.ts"
import { loadDotenv } from "./env.ts"
import { confirm } from "./prompts.ts"
import { renderEvent } from "./render.ts"
import { tryDispatchCommand } from "./commands.ts"
import { ansi } from "./ansi.ts"

// ─── Setup: home dir, .env, config ─────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url)
const workspaceRoot = resolve(dirname(__filename), "..", "..", "..")
loadDotenv([resolve(workspaceRoot, ".env"), resolve(process.cwd(), ".env")])

ensureOmniHome()
const paths = omniPaths()
const wsPaths = workspacePaths()
setFrontmatterParser((raw) => {
  const r = parseFrontmatter(raw)
  return { frontmatter: r.frontmatter as Record<string, unknown>, body: r.body }
})
const config: Config = (() => {
  try {
    return loadMergedConfig()
  } catch (e) {
    console.error(ansi.red(`config error: ${(e as Error).message}`))
    process.exit(2)
  }
})()

// ─── Adapter selection ────────────────────────────────────────────────────
function pickAdapter(): { adapter: ModelAdapter; name: string } {
  const which = (process.env.OMNI_ADAPTER ?? config.adapter ?? "mock").toLowerCase()
  const defaultModel = process.env.OMNI_MODEL ?? config.model

  switch (which) {
    case "mimo": {
      const apiKey = resolveApiKey("mimo", config)
      if (!apiKey) {
        throw new Error("MIMO_API_KEY missing (env or ~/.omni/config.json providers.mimo.apiKey)")
      }
      const model = defaultModel ?? "mimo-v2.5-pro"
      const baseURL = resolveBaseURL("mimo", config)
      return { adapter: mimo({ apiKey, model, baseURL }), name: `mimo:${model}` }
    }
    case "mimo-anthropic": {
      const apiKey = resolveApiKey("mimo-anthropic", config)
      if (!apiKey) throw new Error("MIMO_API_KEY missing")
      const model = defaultModel ?? "mimo-v2.5-pro"
      const baseURL = resolveBaseURL("mimo-anthropic", config)
      return {
        adapter: new AnthropicAdapter({ apiKey, model, baseURL }),
        name: `mimo-anthropic:${model}`,
      }
    }
    case "ollama": {
      const model = defaultModel ?? "qwen2.5-coder:7b"
      return {
        adapter: ollama({ model, baseURL: resolveBaseURL("ollama", config) }),
        name: `ollama:${model}`,
      }
    }
    case "anthropic": {
      const apiKey = resolveApiKey("anthropic", config)
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing")
      const model = defaultModel ?? "claude-sonnet-4-5"
      return {
        adapter: new AnthropicAdapter({ apiKey, model, baseURL: resolveBaseURL("anthropic", config) }),
        name: `anthropic:${model}`,
      }
    }
    case "openai": {
      const apiKey = resolveApiKey("openai", config)
      if (!apiKey) throw new Error("OPENAI_API_KEY missing")
      const model = defaultModel ?? "gpt-4o-mini"
      return {
        adapter: new OpenAIAdapter({ apiKey, model, baseURL: resolveBaseURL("openai", config) }),
        name: `openai:${model}`,
      }
    }
    case "google": {
      const apiKey = resolveApiKey("google", config)
      if (!apiKey) throw new Error("GOOGLE_API_KEY missing")
      const model = defaultModel ?? "gemini-2.0-flash"
      return { adapter: new GoogleAdapter({ apiKey, model }), name: `google:${model}` }
    }
    case "mock":
    default: {
      const script: MockScript[] = [
        { kind: "tool", name: "bash", args: { command: "echo hello-from-omni && pwd" } },
        { kind: "text", text: "Done. Bash ran in the working directory above." },
      ]
      return { adapter: new MockAdapter({ script, deltaMs: 8 }), name: "mock" }
    }
  }
}

// ─── Storage (per-user, ~/.omni/db.sqlite by default) ─────────────────────
mkdirSync(dirname(paths.db), { recursive: true })
const store = new Storage(paths.db)
const sessions = new SessionsRepo(store)
const _messages = new MessagesRepo(store)
const events = new EventsRepo(store)
const audit = new AuditRepo(store)
const profiles = new ProfilesRepo(store)

// ─── Hooks (shell + module) ────────────────────────────────────────────────
const hooks = await loadHooks(config)
if (hooks.length > 0) {
  console.log(ansi.dim(`hooks: loaded ${hooks.length}`))
}

// ─── MCP servers (auto-connect from config) ───────────────────────────────
const mcpManager = new MCPManager(config.mcp?.servers ?? {})
await mcpManager.connectAll()
for (const s of mcpManager.status()) {
  if (s.status === "connected") {
    console.log(ansi.dim(`mcp:${s.name} → connected (${s.toolCount} tool${s.toolCount === 1 ? "" : "s"})`))
  } else if (s.status === "failed") {
    console.log(ansi.red(`mcp:${s.name} → failed: ${s.error}`))
  }
}

// ─── Engine setup ─────────────────────────────────────────────────────────
const { adapter, name: modelName } = pickAdapter()
const tools: readonly Tool[] = [
  bash, readFile, writeFile, edit, multiEdit, glob, grep, webFetch,
  ...mcpManager.tools(),
]

// ─── Probe + adapt (self-improvement layer wired into the CLI) ─────────────
const profileCache = new SqliteProfileCache(profiles)
let activeProfile: Awaited<ReturnType<typeof probeModelCached>> | null = null
let activeStrategy: ReturnType<typeof adapt> | null = null
const isMockAdapter = modelName === "mock"
if (!isMockAdapter) {
  try {
    activeProfile = await probeModelCached(adapter, profileCache, {
      maxAgeMs: 24 * 60 * 60 * 1000, // 24h
    })
    activeStrategy = adapt(activeProfile)
  } catch (e) {
    console.error(ansi.dim(`probe skipped: ${(e as Error).message}`))
  }
}

const askGate = new AskPermissions(async (tool, call) => {
  const argsPreview = truncate(JSON.stringify(call.args), 200)
  process.stdout.write("\n")
  const ok = await confirm(`Allow ${ansi.bold(tool.name)}(${ansi.dim(argsPreview)})?`, true)
  return ok ? "allow" : "deny"
})

const permissions = new AuditingPermissions(askGate, {
  record(entry) {
    audit.append({
      session_id: entry.sessionId || undefined,
      tool: entry.toolName,
      decision: entry.decision,
      args: entry.call.args,
      timestamp: entry.timestamp,
    })
  },
})

const baseSystemPrompt =
  config.systemPrompt ??
  activeStrategy?.systemPrompt ??
  "You are Omni, an autonomous coding agent. Use tools to gather information. Be terse. Do not narrate intent before tool use."

const engine = new Engine({
  model: adapter,
  tools,
  permissions,
  systemPrompt: baseSystemPrompt,
  maxIterations: config.maxIterations ?? activeStrategy?.maxIterations ?? 12,
  enableReActFallback: config.enableReActFallback ?? activeStrategy?.enableReActFallback ?? true,
  contextManager: new ContextManager(
    new TokenBudgetStrategy(new TiktokenTokenizer(), {
      reserveTokensForOutput: activeStrategy?.reserveOutputTokens ?? 4_096,
    }),
  ),
  tracer: (event) => {
    events.append({
      session_id: engine.sessionId(),
      t: Date.now(),
      type: event.type,
      data: event,
    })
  },
  hooks,
})

sessions.create(engine.sessionId(), modelName)

// ─── Skills ────────────────────────────────────────────────────────────────
const skills = loadSkills()
let activeSkill: Skill | null = null
const skillAutoRoute = config.skills?.autoRoute !== false
const skillsEnabled = (() => {
  const enabled = config.skills?.enabled
  const disabled = config.skills?.disabled ?? []
  if (enabled) return new Set(enabled)
  if (disabled.length > 0) {
    const out = new Set<string>()
    for (const [name] of skills) if (!disabled.includes(name)) out.add(name)
    return out
  }
  return new Set(skills.keys())
})()

function applySkill(skill: Skill | null) {
  activeSkill = skill
  // The engine's systemPrompt and tool set are fixed at construction. We
  // can't swap them in mid-flight without a new engine — but we DO support
  // it by prepending the skill's prompt as a fresh system message before
  // each run.
}

function activeSkillTools(): readonly Tool[] {
  return activeSkill ? filterToolsBySkill(tools, activeSkill) : tools
}

// ─── Optional file tracer ──────────────────────────────────────────────────
const traceEnabled = config.storage?.tracesEnabled !== false
const fileTracer = traceEnabled
  ? new FileTracer({ path: resolve(paths.traces, `${engine.sessionId()}.jsonl`) })
  : null

// ─── Interactive REPL ──────────────────────────────────────────────────────
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: ansi.bold("> "),
})

console.log(
  `${ansi.bold("Omni")} ${ansi.dim(`(${modelName}, ctx ${adapter.capabilities.contextWindow})`)}`,
)
console.log(ansi.dim(`home: ${paths.home}`))
if (wsPaths) console.log(ansi.dim(`workspace: ${wsPaths.home}`))
if (activeProfile && activeStrategy) {
  const flags = [
    activeProfile.nativeToolCalls ? "native-tools" : "react-fallback",
    activeProfile.followsInstructions ? "follows" : "loose",
    activeProfile.verboseByDefault ? "verbose" : "terse",
  ].join(", ")
  console.log(ansi.dim(`probed: ${flags}`))
}
console.log(ansi.dim("Type a message, or /help for commands, /quit to exit."))
console.log()

let currentRun: AbortController | null = null
let exiting = false

process.on("SIGINT", () => {
  if (currentRun) {
    console.log(ansi.dim("\n[ctrl-c — aborting current run]"))
    currentRun.abort()
  } else {
    console.log(ansi.dim("\nbye"))
    cleanup()
    process.exit(0)
  }
})

async function run() {
  rl.prompt()
  for await (const line of rl) {
    if (exiting) break
    const input = line.trim()
    if (!input) {
      rl.prompt()
      continue
    }

    // Auto-route to a skill if the input matches and auto-route is enabled
    // and the user hasn't manually pinned a skill.
    if (skillAutoRoute && !activeSkill && !input.startsWith("/")) {
      const eligible = [...skills.values()].filter((s) => skillsEnabled.has(s.name))
      const matched = findMatchingSkill(input, eligible)
      if (matched) {
        applySkill(matched)
        console.log(ansi.dim(`[skill auto-activated: ${matched.name}]`))
      }
    }

    const cmdResult = await tryDispatchCommand(input, {
      engine,
      modelName,
      profile: activeProfile,
      strategy: activeStrategy,
      skills,
      activeSkill,
      onSkillChange: applySkill,
      mcpManager,
    })
    let effectiveInput = input
    if (cmdResult) {
      if (cmdResult.kind === "exit") {
        exiting = true
        break
      }
      if (cmdResult.kind === "message") {
        console.log(cmdResult.text)
        rl.prompt()
        continue
      }
      if (cmdResult.kind === "prompt") {
        effectiveInput = cmdResult.text
        console.log(ansi.dim(`[command rendered to ${effectiveInput.length} chars]`))
      }
    }

    currentRun = new AbortController()
    const runOpts: { signal: AbortSignal; systemPromptPrefix?: string; enabledTools?: Set<string> } = {
      signal: currentRun.signal,
    }
    if (activeSkill) {
      runOpts.systemPromptPrefix = activeSkill.systemPrompt
      if (activeSkill.toolsOnly) {
        runOpts.enabledTools = new Set(activeSkill.toolsOnly)
      }
    }
    try {
      for await (const ev of engine.run(effectiveInput, runOpts)) {
        const out = renderEvent(ev)
        if (out) process.stdout.write(out)
        if (fileTracer) fileTracer.record(ev)
      }
    } catch (e) {
      console.error(ansi.red(`\nerror: ${(e as Error).message}`))
    } finally {
      currentRun = null
    }

    rl.prompt()
  }
  cleanup()
}

function cleanup(): void {
  sessions.setStatus(engine.sessionId(), "completed")
  store.close()
  if (fileTracer) void fileTracer.flush()
  void mcpManager.closeAll()
  rl.close()
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

await run()
process.exit(0)
