/**
 * Shared engine bootstrap — used by both the TUI driver (tui/main.tsx)
 * and the plain readline REPL (plain.ts).
 *
 * Returns a fully-wired engine plus all the repos / helpers a surface
 * needs to render status, dispatch slash commands, and continue past
 * sessions.
 */
import { resolve, dirname } from "node:path"
import { mkdirSync } from "node:fs"
import {
  Engine,
  AskPermissions,
  AllowAllPermissions,
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
  buildSystemPrompt,
  type ModelAdapter,
  type Tool,
  type Config,
  type Verifier,
  type PermissionGate,
  type OmniPaths,
  type WorkspacePaths,
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
import {
  bash, readFile, writeFile, edit, multiEdit, applyPatch, glob, grep, webFetch, MCPManager,
  PatchAppliesVerifier, FileParsesVerifier, TypecheckVerifier, TestVerifier,
} from "@omni/tools"
import { Storage, SessionsRepo, MessagesRepo, EventsRepo, AuditRepo, ProfilesRepo } from "@omni/storage"
import {
  FileTracer,
  SqliteProfileCache,
  probeModelCached,
  adapt,
  loadSkills,
  setFrontmatterParser,
  type Skill,
} from "@omni/improve"
import { parseFrontmatter } from "./user-commands.ts"
import { loadHooks } from "./hook-loader.ts"
import { loadDotenv } from "./env.ts"
import { ansi } from "./ansi.ts"

export interface BootstrapOptions {
  /**
   * How permission "ask" prompts should resolve.
   *   - "allow":   auto-allow (default in TUI for v1 — a modal will land later)
   *   - "deny":    auto-deny
   *   - "callback": defer to the provided handler (used by the plain REPL)
   */
  readonly askMode?: "allow" | "deny" | "callback"
  /** Handler when askMode === "callback". Receives the tool + call. */
  readonly askHandler?: (tool: { name: string; description: string }, call: { args: unknown }) => Promise<"allow" | "deny">
  /** Print progress to stdout during bootstrap (plain mode). TUI runs silent. */
  readonly verbose?: boolean
  /**
   * Extra tools to register on the engine (e.g. surface-specific tools
   * like ask_user that need access to the TUI's modal queue).
   */
  readonly extraTools?: readonly Tool[]
}

export interface BootstrapResult {
  readonly engine: Engine
  readonly adapter: ModelAdapter
  readonly modelName: string
  readonly config: Config
  readonly paths: OmniPaths
  readonly wsPaths: WorkspacePaths | null
  readonly tools: readonly Tool[]
  readonly verifiers: readonly Verifier[]
  readonly mcpManager: MCPManager
  readonly profileCache: SqliteProfileCache
  readonly activeProfile: Awaited<ReturnType<typeof probeModelCached>> | null
  readonly activeStrategy: ReturnType<typeof adapt> | null
  readonly fileTracer: FileTracer | null
  readonly skills: Map<string, Skill>
  readonly skillsEnabled: ReadonlySet<string>
  readonly skillAutoRoute: boolean
  readonly sessions: SessionsRepo
  readonly messages: MessagesRepo
  readonly events: EventsRepo
  readonly audit: AuditRepo
  readonly profiles: ProfilesRepo
  readonly storage: Storage
  readonly continueSession: (id: string) => boolean
  readonly cleanup: () => Promise<void>
}

export async function bootstrap(opts: BootstrapOptions = {}): Promise<BootstrapResult> {
  const log = opts.verbose ? (line: string) => console.log(line) : () => {}

  // ─── Setup: home dir, .env, config ───────────────────────────────────────
  ensureOmniHome()
  const paths = omniPaths()
  // .env precedence (later wins via loadDotenv overriding): repo .env (dev) <
  // cwd .env (per-project) < ~/.omni/.env (per-user, used by the compiled
  // binary which has no repo-relative path). When running from source,
  // `import.meta.dir` points at packages/cli/src; the repo root is 3 up.
  const repoEnv = resolve(import.meta.dir, "..", "..", "..", ".env")
  loadDotenv([repoEnv, resolve(process.cwd(), ".env"), resolve(paths.home, ".env")])
  const wsPaths = workspacePaths()
  setFrontmatterParser((raw) => {
    const r = parseFrontmatter(raw)
    return { frontmatter: r.frontmatter as Record<string, unknown>, body: r.body }
  })
  const config = loadMergedConfig()

  // ─── Storage ────────────────────────────────────────────────────────────
  mkdirSync(dirname(paths.db), { recursive: true })
  const storage = new Storage(paths.db)
  const sessions = new SessionsRepo(storage)
  const messages = new MessagesRepo(storage)
  const events = new EventsRepo(storage)
  const audit = new AuditRepo(storage)
  const profiles = new ProfilesRepo(storage)

  // ─── Hooks ──────────────────────────────────────────────────────────────
  const hooks = await loadHooks(config)
  if (hooks.length > 0) log(ansi.dim(`hooks: loaded ${hooks.length}`))

  // ─── MCP ────────────────────────────────────────────────────────────────
  const mcpManager = new MCPManager(config.mcp?.servers ?? {})
  await mcpManager.connectAll()
  for (const s of mcpManager.status()) {
    if (s.status === "connected") {
      log(ansi.dim(`mcp:${s.name} → connected (${s.toolCount} tool${s.toolCount === 1 ? "" : "s"})`))
    } else if (s.status === "failed") {
      log(ansi.red(`mcp:${s.name} → failed: ${s.error}`))
    }
  }

  // ─── Adapter selection ──────────────────────────────────────────────────
  const { adapter, name: modelName } = pickAdapter(config)

  // ─── Tools ──────────────────────────────────────────────────────────────
  const tools: readonly Tool[] = [
    bash, readFile, writeFile, edit, multiEdit, applyPatch, glob, grep, webFetch,
    ...mcpManager.tools(),
    ...(opts.extraTools ?? []),
  ]

  // ─── Probe + adapt ──────────────────────────────────────────────────────
  const profileCache = new SqliteProfileCache(profiles)
  let activeProfile: BootstrapResult["activeProfile"] = null
  let activeStrategy: BootstrapResult["activeStrategy"] = null
  if (modelName !== "mock") {
    try {
      activeProfile = await probeModelCached(adapter, profileCache, {
        maxAgeMs: 24 * 60 * 60 * 1000, // 24h
      })
      activeStrategy = adapt(activeProfile)
    } catch (e) {
      log(ansi.dim(`probe skipped: ${(e as Error).message}`))
    }
  }

  // ─── Permissions ────────────────────────────────────────────────────────
  const permissions = buildPermissions(opts, audit)

  // ─── Verifiers ──────────────────────────────────────────────────────────
  const verifiers = buildVerifiers(config)
  if (verifiers.length > 0) {
    log(ansi.dim(`verifiers: ${verifiers.map((v) => v.name).join(", ")}`))
  }

  // ─── Engine ─────────────────────────────────────────────────────────────
  // Comprehensive system prompt composed with the live context (cwd, the
  // actual tool set, the active verifiers) and the probed model's tuning
  // (ReAct format if no native tool calls; stronger terseness if verbose).
  // A user-set config.systemPrompt overrides the whole thing.
  const baseSystemPrompt =
    config.systemPrompt ??
    buildSystemPrompt({
      cwd: process.cwd(),
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
      verifiers: verifiers.map((v) => v.name),
      nativeToolCalls: activeProfile?.nativeToolCalls ?? true,
      verbose: activeProfile?.verboseByDefault ?? false,
    })

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
    verifiers,
  })
  sessions.create(engine.sessionId(), modelName)

  // ─── Skills ─────────────────────────────────────────────────────────────
  const skills = loadSkills()
  const skillAutoRoute = config.skills?.autoRoute !== false
  const skillsEnabled: ReadonlySet<string> = (() => {
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

  // ─── File tracer ────────────────────────────────────────────────────────
  const traceEnabled = config.storage?.tracesEnabled !== false
  const fileTracer = traceEnabled
    ? new FileTracer({ path: resolve(paths.traces, `${engine.sessionId()}.jsonl`) })
    : null

  // ─── Session continuation ───────────────────────────────────────────────
  function continueSession(id: string): boolean {
    const row = sessions.get(id)
    if (!row) return false
    const history = messages.bySession(id)
    if (history.length === 0) return false
    engine.restore({
      sessionId: id,
      messages: history.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        toolCalls: m.tool_calls?.map((c) => ({ id: c.id, name: c.name, args: c.args })),
        toolCallId: m.tool_call_id,
        metadata: m.metadata,
        timestamp: m.timestamp,
      })),
      usage: reconstructUsage(events, id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })
    sessions.setStatus(id, "active")
    return true
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────
  async function cleanup(): Promise<void> {
    sessions.setStatus(engine.sessionId(), "completed")
    if (fileTracer) {
      try {
        await fileTracer.flush()
      } catch (e) {
        console.error(ansi.red(`tracer flush failed: ${(e as Error).message}`))
      }
    }
    try {
      await mcpManager.closeAll()
    } catch (e) {
      console.error(ansi.red(`mcp shutdown error: ${(e as Error).message}`))
    }
    storage.close()
  }

  return {
    engine,
    adapter,
    modelName,
    config,
    paths,
    wsPaths,
    tools,
    verifiers,
    mcpManager,
    profileCache,
    activeProfile,
    activeStrategy,
    fileTracer,
    skills,
    skillsEnabled,
    skillAutoRoute,
    sessions,
    messages,
    events,
    audit,
    profiles,
    storage,
    continueSession,
    cleanup,
  }
}

// ─── Adapter pick ──────────────────────────────────────────────────────────

function pickAdapter(config: Config): { adapter: ModelAdapter; name: string } {
  // Default chain: explicit env > config > auto-detect MiMo from key > mock.
  // The auto-detect means a fresh `omni` with MIMO_API_KEY set just works,
  // without anyone having to remember OMNI_ADAPTER=mimo.
  const autoDetected =
    !process.env.OMNI_ADAPTER && !config.adapter && resolveApiKey("mimo", config) ? "mimo" : undefined
  const which = (process.env.OMNI_ADAPTER ?? config.adapter ?? autoDetected ?? "mock").toLowerCase()
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

// ─── Helpers ───────────────────────────────────────────────────────────────

function buildPermissions(opts: BootstrapOptions, audit: AuditRepo): PermissionGate {
  const mode = opts.askMode ?? "allow"
  let base: PermissionGate
  if (mode === "callback" && opts.askHandler) {
    base = new AskPermissions(async (tool, call) => {
      const decision = await opts.askHandler!(
        { name: tool.name, description: tool.description },
        { args: call.args },
      )
      return decision
    })
  } else if (mode === "deny") {
    base = new AskPermissions(async () => "deny")
  } else {
    base = new AllowAllPermissions()
  }
  return new AuditingPermissions(base, {
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
}

function buildVerifiers(config: Config): readonly Verifier[] {
  const out: Verifier[] = []
  const v = config.verifiers
  if (!v?.disableBuiltins) {
    out.push(new PatchAppliesVerifier(), new FileParsesVerifier())
  }
  if (v?.typecheck?.enabled) {
    out.push(
      new TypecheckVerifier({
        command: v.typecheck.command,
        cwd: v.typecheck.cwd,
        timeoutMs: v.typecheck.timeoutMs,
        appliesTo: v.typecheck.appliesTo,
      }),
    )
  }
  if (v?.tests?.enabled) {
    out.push(
      new TestVerifier({
        command: v.tests.command,
        cwd: v.tests.cwd,
        timeoutMs: v.tests.timeoutMs,
        appliesTo: v.tests.appliesTo,
      }),
    )
  }
  return out
}

function reconstructUsage(events: EventsRepo, sessionId: string): {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  callCount: number
  costUsd?: number
} {
  const stored = events.bySession(sessionId)
  for (let i = stored.length - 1; i >= 0; i--) {
    const ev = stored[i]!
    if (ev.type === "engine.usage") {
      const d = ev.data as { total?: unknown }
      if (d && typeof d === "object" && d.total && typeof d.total === "object") {
        const t = d.total as Record<string, unknown>
        return {
          promptTokens: numberOr(t.promptTokens, 0),
          completionTokens: numberOr(t.completionTokens, 0),
          totalTokens: numberOr(t.totalTokens, 0),
          callCount: numberOr(t.callCount, 0),
          costUsd: typeof t.costUsd === "number" ? t.costUsd : undefined,
        }
      }
    }
  }
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 }
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback
}
