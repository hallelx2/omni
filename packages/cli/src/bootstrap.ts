/**
 * Shared engine bootstrap — used by both the TUI driver (tui/main.tsx)
 * and the plain readline REPL (plain.ts).
 *
 * Returns a fully-wired engine plus all the repos / helpers a surface
 * needs to render status, dispatch slash commands, and continue past
 * sessions.
 */
import { resolve, dirname, join } from "node:path"
import { mkdirSync, existsSync } from "node:fs"
import { release } from "node:os"
import {
  Engine,
  AskPermissions,
  AllowAllPermissions,
  GuardedPermissions,
  workspaceGuards,
  TokenBudgetStrategy,
  SummarizingStrategy,
  SlidingWindowStrategy,
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
  type PermissionRule,
  type ContextStrategy,
  type OmniPaths,
  type WorkspacePaths,
  type EngineEvent,
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
  makeDispatchAgentsTool, bashShell, setBashShellPref,
} from "@omni/tools"
import { Storage, SessionsRepo, MessagesRepo, EventsRepo, AuditRepo, ProfilesRepo, VectorMemoryRepo, VariantsRepo } from "@omni/storage"
import {
  FileTracer,
  SqliteProfileCache,
  probeModelCached,
  adapt,
  adaptFromPool,
  poolFromRows,
  rowFromVariant,
  addVariant,
  emptyPool,
  mutatePrompt,
  scoreTrace,
  EVOLUTION_SEED,
  loadSkills,
  loadAgents,
  renderSkillForAgent,
  setFrontmatterParser,
  setAgentFrontmatterParser,
  Planner,
  Critic,
  VectorMemory,
  type Skill,
  type Agent,
  type EvolveMode,
  type VariantPool,
} from "@omni/improve"
import { buildMemory, makeRememberTool, recallBlock } from "./memory-runtime.ts"
import { makeDedupReadFile } from "./read-dedup.ts"
import { ModeAwarePermissions } from "./mode-aware-permissions.ts"
import { parseFrontmatter } from "./user-commands.ts"
import { resolveAdapter, makeAgentTool, agentToolName, structuredConfigFor, type BuildAgentDeps } from "./agents-runtime.ts"
import { createModeHolder, type ModeHolder, type RunMode } from "./mode.ts"
import { createRequestBuildTool } from "./requestBuildTool.ts"
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
  /**
   * Human gate for the agent-initiated plan→build switch (request_build_mode).
   * Resolves true to allow the switch. Omitted → auto-approve.
   */
  readonly onRequestBuildConfirm?: (plan: string | null) => Promise<boolean>
  /**
   * Progress callback for surfaces that paint a boot screen while bootstrap
   * runs in the background (the TUI). Called at the slow milestones —
   * connecting tools and probing the model.
   */
  readonly onProgress?: (step: string) => void
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
  /** Prompt-evolution variant store (model-scoped). */
  readonly variants: VariantsRepo
  /** Id of the evolved variant driving this session, or null (static/disabled). */
  readonly activeVariantId: string | null
  /** Operating-rules text of the active variant, layered as a per-run prefix. */
  readonly activeVariantText: string | null
  /** This session's variant pool for the active model (hydrated at startup). */
  readonly activePool: VariantPool
  /** Why the active prompt was chosen, or null when evolution is off. */
  readonly evolveMode: EvolveMode | null
  /** Per-model key for the variant pool (the adapter id). */
  readonly evolveModelId: string
  readonly fileTracer: FileTracer | null
  readonly skills: Map<string, Skill>
  readonly skillsEnabled: ReadonlySet<string>
  readonly skillAutoRoute: boolean
  readonly agents: Map<string, Agent>
  readonly mode: ModeHolder
  readonly planner: Planner
  readonly critic: Critic
  readonly criticAutoRetry: boolean
  readonly agentFlags: { readonly usePlanner: boolean; readonly useCritic: boolean }
  /** Long-term memory, or null when disabled (config.memory.enabled). */
  readonly memory: VectorMemory | null
  /** Recall closure for the turn loop; undefined when memory is off or autoRecall is disabled. */
  readonly recallMemory?: (input: string) => Promise<string | null>
  /** Non-fatal model-resolution warnings (e.g. missing key → fell back to main model). */
  readonly modelWarnings: readonly string[]
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
  const progress = opts.onProgress ?? (() => {})

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
  setAgentFrontmatterParser((raw) => {
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
  const vectorRepo = new VectorMemoryRepo(storage)
  const variants = new VariantsRepo(storage)

  // ─── Hooks ──────────────────────────────────────────────────────────────
  const hooks = await loadHooks(config)
  if (hooks.length > 0) log(ansi.dim(`hooks: loaded ${hooks.length}`))

  // ─── MCP ────────────────────────────────────────────────────────────────
  const mcpManager = new MCPManager(config.mcp?.servers ?? {})
  if (Object.keys(config.mcp?.servers ?? {}).length > 0) progress("connecting tools…")
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

  // ─── Tools: base set, then agents, dispatch, modes ───────────────────────
  // The base set is what subagent CHILDREN draw from. The main engine also
  // gets the agent tools, the dispatch fan-out tool, and request_build_mode —
  // none of which children receive (prevents agent→agent recursion).
  const builtinTools: Tool[] = [
    bash, readFile, writeFile, edit, multiEdit, applyPatch, glob, grep, webFetch,
    ...mcpManager.tools(),
  ]

  const agentsEnabled = config.agents?.enabled !== false
  const agents = loadAgents()
  for (const name of config.agents?.disabled ?? []) agents.delete(name)

  // Per-role model resolution. Warnings (e.g. a missing API key for an
  // override) are collected here and surfaced by the surface at startup —
  // NOT verbose-gated, so the TUI shows them too.
  const modelWarnings: string[] = []
  const adapterCache = new Map<string, ModelAdapter>()
  const resolveModel = (ref?: string): ModelAdapter =>
    resolveAdapter(ref, {
      config,
      fallback: adapter,
      cache: adapterCache,
      warn: (m) => modelWarnings.push(m),
    })
  // Skills are loaded BEFORE agent tools so specialized agents can attach them
  // (frontend-engineer → frontend-design, etc.). loadSkills now also reads
  // ~/.claude/skills, so installed Claude skills are reachable.
  const skills = loadSkills()
  const agentBuildDeps: BuildAgentDeps = {
    tools: builtinTools,
    config,
    resolveModel,
    cwd: process.cwd(),
    skills,
    renderSkill: renderSkillForAgent,
  }

  const reservedNames = new Set<string>([
    ...builtinTools.map((t) => t.name),
    "dispatch_agents",
    "request_build_mode",
  ])
  const agentToolMap = new Map<string, ReturnType<typeof makeAgentTool>>()
  const agentTools: Tool[] = []
  if (agentsEnabled) {
    for (const agent of agents.values()) {
      const tname = agentToolName(agent.name)
      if (reservedNames.has(tname)) {
        log(ansi.dim(`agent "${agent.name}" skipped: tool name "${tname}" is reserved`))
        continue
      }
      const t = makeAgentTool(agent, agentBuildDeps)
      reservedNames.add(tname)
      agentTools.push(t)
      agentToolMap.set(agent.name, t)
    }
  }
  // Eagerly resolve per-agent model overrides so a missing key surfaces at
  // startup (warming the shared cache) rather than silently on first dispatch.
  for (const a of agents.values()) if (a.model) resolveModel(a.model)
  // Warn once if any agent references a skill that isn't installed.
  for (const a of agents.values()) {
    for (const s of a.skills ?? []) {
      if (!skills.has(s)) modelWarnings.push(`agent "${a.name}": skill "${s}" not found`)
    }
  }
  const dispatchTool =
    agentsEnabled && agentToolMap.size > 0
      ? makeDispatchAgentsTool({
          getAgentTool: (name) => agentToolMap.get(name),
          listAgents: () => [...agentToolMap.keys()],
          defaultMaxConcurrency: config.agents?.maxConcurrency,
        })
      : null

  const mode = createModeHolder(config.modes?.default ?? "build")
  const requestBuild = createRequestBuildTool(
    mode,
    opts.onRequestBuildConfirm ? { confirm: opts.onRequestBuildConfirm } : undefined,
  )

  // ─── Long-term memory (opt-in: config.memory.enabled + embeddingModel) ─────
  const memory = buildMemory(config, vectorRepo, (m) => modelWarnings.push(m))
  const rememberTool = memory ? makeRememberTool(memory) : null
  const recallMemory =
    memory && config.memory?.autoRecall !== false
      ? (input: string) =>
          recallBlock(memory, input, { k: config.memory?.k, minScore: config.memory?.minScore })
      : undefined

  // The main engine gets a dedup-wrapped read_file (won't re-send an unchanged
  // file it already read); subagents keep the raw one — their contexts differ.
  const mainBuiltins = builtinTools.map((t) => (t.name === "read_file" ? makeDedupReadFile(t) : t))
  const tools: readonly Tool[] = [
    ...mainBuiltins,
    ...agentTools,
    ...(dispatchTool ? [dispatchTool] : []),
    ...(rememberTool ? [rememberTool] : []),
    requestBuild,
    ...(opts.extraTools ?? []),
  ]
  if (agentTools.length > 0) {
    log(ansi.dim(`agents: ${[...agentToolMap.keys()].join(", ")}`))
  }

  // ─── Probe + adapt (+ evolve loop selection) ──────────────────────────────
  const profileCache = new SqliteProfileCache(profiles)
  const evolveCfg = config.improve?.evolve
  const evolveEnabled = evolveCfg?.enabled === true && modelName !== "mock"
  const evolveModelId = adapter.id
  let activeProfile: BootstrapResult["activeProfile"] = null
  let activeStrategy: BootstrapResult["activeStrategy"] = null
  let activePool: VariantPool = emptyPool()
  let activeVariantId: string | null = null
  let activeVariantText: string | null = null
  let evolveMode: EvolveMode | null = null
  if (modelName !== "mock") {
    progress(`probing ${modelName}…`)
    try {
      activeProfile = await probeModelCached(adapter, profileCache, {
        maxAgeMs: 24 * 60 * 60 * 1000, // 24h
      })
      if (evolveEnabled && activeProfile) {
        // Hydrate (and, on first contact, seed) this model's variant pool, then
        // select a prompt variant by fitness. The variant is an operating-rules
        // ADDENDUM layered on the environment-aware base prompt — never a swap.
        activePool = poolFromRows(variants.forModel(evolveModelId))
        if (activePool.variants.length === 0) {
          const { variant } = addVariant(emptyPool(), EVOLUTION_SEED)
          variants.upsert(rowFromVariant(evolveModelId, variant))
          activePool = poolFromRows(variants.forModel(evolveModelId))
        }
        const sel = adaptFromPool(activeProfile, activePool, {
          minTrials: evolveCfg?.minTrials,
          explorationRate: evolveCfg?.explorationRate,
          tournamentK: evolveCfg?.tournamentK,
        })
        activeStrategy = sel.strategy
        activeVariantId = sel.variant?.id ?? null
        activeVariantText = sel.variant?.text ?? null
        evolveMode = sel.mode
        log(ansi.dim(`evolve: ${sel.mode}${activeVariantId ? ` (variant ${activeVariantId.slice(0, 8)})` : ""}, ${activePool.variants.length} in pool`))
      } else {
        activeStrategy = adapt(activeProfile)
      }
    } catch (e) {
      log(ansi.dim(`probe skipped: ${(e as Error).message}`))
    }
  }

  // ─── Planner / Critic (back plan/build mode; per-role model overrides) ────
  // Structured output (generateObject) is enabled when the resolved model
  // exposes an AI SDK languageModel: trusted for frontier overrides, gated on
  // the probe for the main model. Both fall back to text parsing automatically.
  const plannerAdapter = resolveModel(config.agents?.planner?.model)
  const criticAdapter = resolveModel(config.agents?.critic?.model)
  const structured = (m: ModelAdapter) =>
    structuredConfigFor(m, {
      isMain: m === adapter,
      mainSupportsStructured: activeProfile?.supportsStructuredOutput,
    })
  const errText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
  const planner = new Planner(plannerAdapter, {
    maxSteps: config.agents?.planner?.maxSteps,
    ...structured(plannerAdapter),
    onStructuredFallback: (cause) =>
      log(ansi.dim(`planner: structured output unavailable; using text (${errText(cause)})`)),
  })
  const critic = new Critic(criticAdapter, {
    retryBelow: config.agents?.critic?.retryBelow,
    ...structured(criticAdapter),
    onStructuredFallback: (cause) =>
      log(ansi.dim(`critic: structured output unavailable; using text (${errText(cause)})`)),
  })
  const criticAutoRetry = config.agents?.critic?.autoRetry ?? false
  const agentFlags = {
    usePlanner: config.agents?.planner?.enabled ?? activeStrategy?.usePlanner ?? false,
    useCritic: config.agents?.critic?.enabled ?? activeStrategy?.useCritic ?? false,
  }

  // ─── Permissions ────────────────────────────────────────────────────────
  const permissions = buildPermissions(opts, audit, config, () => mode.get())

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
  setBashShellPref(config.bash?.shell)
  const shellInfo = bashShell()
  const baseSystemPrompt =
    config.systemPrompt ??
    buildSystemPrompt({
      cwd: process.cwd(),
      shell: shellInfo.label,
      shellFamily: shellInfo.family,
      shellKind: shellInfo.kind,
      osVersion: release(),
      arch: process.arch,
      isGitRepo: existsSync(join(process.cwd(), ".git")),
      tools: tools.map((t) => ({ name: t.name, description: t.description })),
      verifiers: verifiers.map((v) => v.name),
      nativeToolCalls: activeProfile?.nativeToolCalls ?? true,
      verbose: activeProfile?.verboseByDefault ?? false,
      extra: agentRoutingBlock(agents, agentToolMap),
    })

  progress("starting engine…")
  const engine = new Engine({
    model: adapter,
    tools,
    permissions,
    systemPrompt: baseSystemPrompt,
    maxIterations: config.maxIterations ?? 0, // 0 = unbounded; run until done/loop/abort
    enableReActFallback: config.enableReActFallback ?? activeStrategy?.enableReActFallback ?? true,
    contextManager: new ContextManager(
      buildContextStrategy(config, {
        summariser: adapter,
        resolveModel,
        reserveOutputTokens: activeStrategy?.reserveOutputTokens ?? 4_096,
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

  // ─── Skills (loaded earlier, before agent tools) ─────────────────────────
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

    // ─── Close the self-improvement loop ─────────────────────────────────────
    // Score this session's trace (verifier-grounded) and fold it into the
    // active variant, then occasionally seed a mutated challenger. The DB
    // events table is authoritative (written by the tracer, independent of
    // tracesEnabled). Any failure here is non-fatal — never block shutdown.
    if (evolveEnabled) {
      try {
        const evs = events
          .bySession(engine.sessionId())
          .map((r) => r.data as EngineEvent)
        if (evs.length > 0) {
          const score = scoreTrace(evs)
          if (activeVariantId) variants.recordTrial(activeVariantId, score)
          // Seed a mutated challenger from the current best, sometimes.
          if (Math.random() < (evolveCfg?.mutationRate ?? 0.15)) {
            const top = variants.ranked(evolveModelId)[0]
            if (top) {
              const childText = mutatePrompt(top.text)
              if (childText !== top.text) {
                const { variant } = addVariant(emptyPool(), childText, top.id)
                variants.upsert(rowFromVariant(evolveModelId, variant))
              }
            }
          }
        }
      } catch (e) {
        console.error(ansi.red(`evolve: recordTrial failed: ${(e as Error).message}`))
      }
    }

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
    variants,
    activeVariantId,
    activeVariantText,
    activePool,
    evolveMode,
    evolveModelId,
    fileTracer,
    skills,
    skillsEnabled,
    skillAutoRoute,
    agents,
    mode,
    planner,
    critic,
    criticAutoRetry,
    agentFlags,
    memory,
    recallMemory,
    modelWarnings,
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

/**
 * Select the context-window strategy from config. Default "summarize" compacts
 * older turns into a model-written summary (preserving their substance) and only
 * triggers near the window limit — short sessions pay nothing. "budget" drops
 * the oldest messages instead; "sliding" keeps only the most recent. The
 * summariser defaults to the main model but can be a cheaper per-role model;
 * summarisation falls back to "budget" if a summarise call fails.
 */
export function buildContextStrategy(
  config: Config,
  deps: {
    readonly summariser: ModelAdapter
    readonly resolveModel: (ref?: string) => ModelAdapter
    readonly reserveOutputTokens: number
  },
): ContextStrategy {
  const tokenizer = new TiktokenTokenizer()
  const budget = new TokenBudgetStrategy(tokenizer, {
    reserveTokensForOutput: deps.reserveOutputTokens,
  })
  const c = config.context
  switch (c?.compaction ?? "summarize") {
    case "budget":
      return budget
    case "sliding":
      return new SlidingWindowStrategy()
    case "summarize":
    default:
      return new SummarizingStrategy({
        summariser: c?.summarizerModel ? deps.resolveModel(c.summarizerModel) : deps.summariser,
        inner: budget,
        tokenizer,
        ...(c?.keepRecent !== undefined ? { keepRecent: c.keepRecent } : {}),
        ...(c?.summarizeAboveTokens !== undefined ? { summariseAboveTokens: c.summarizeAboveTokens } : {}),
      })
  }
}

/**
 * A compact routing block appended to the main system prompt: lists each
 * specialized subagent that became a tool, with its language/domain hints, so
 * the model delegates matching work. Returns undefined when there are none.
 */
function agentRoutingBlock(
  agents: Map<string, Agent>,
  agentToolMap: ReadonlyMap<string, unknown>,
): string | undefined {
  const usable = [...agents.values()].filter((a) => agentToolMap.has(a.name))
  if (usable.length === 0) return undefined
  const lines = usable.map((a) => {
    const langs = a.languages?.length ? ` [langs: ${a.languages.join(", ")}]` : ""
    const doms = a.domains?.length ? ` [domains: ${a.domains.join(", ")}]` : ""
    return `- ${agentToolName(a.name)}: ${a.description}${langs}${doms}`
  })
  return [
    "═══ SPECIALIZED SUBAGENTS — DELEGATE MATCHING WORK ═══",
    "",
    "Route a task to the subagent whose languages/domains match it; each runs in its own",
    "sandbox with its own tools and permissions. Use dispatch_agents to fan several",
    "independent tasks out in parallel.",
    ...lines,
  ].join("\n")
}

function buildPermissions(
  opts: BootstrapOptions,
  audit: AuditRepo,
  config: Config,
  getRunMode: () => RunMode,
): PermissionGate {
  const askMode = opts.askMode ?? "allow"
  let base: PermissionGate
  if (askMode === "callback" && opts.askHandler) {
    base = new AskPermissions(async (tool, call) => {
      const decision = await opts.askHandler!(
        { name: tool.name, description: tool.description },
        { args: call.args },
      )
      return decision
    })
  } else if (askMode === "deny") {
    base = new AskPermissions(async () => "deny")
  } else {
    base = new AllowAllPermissions()
  }

  // Mode-aware shim: in "auto" mode, ask-prompts are auto-allowed (unattended).
  // Wrapped INSIDE the safety guard layer so destructive-bash / workspace
  // confinement still apply regardless of mode.
  const modeAware: PermissionGate = new ModeAwarePermissions(base, getRunMode)

  // Layer config-driven safety guards over the mode-aware base. Destructive
  // bash is denied by default (matching subagents) and workspace confinement
  // is opt-in. `autoAllow` names bypass the prompt, but only AFTER the safety
  // denies, so they can't re-enable something dangerous.
  const perms = config.permissions ?? {}
  const guards: PermissionRule[] = [
    ...workspaceGuards({
      denyDestructiveBash: perms.denyDestructive !== false,
      restrictToRoot: perms.restrictToWorkspace === true,
      root: process.cwd(),
    }),
    ...(perms.autoAllow ?? []).map((tool): PermissionRule => ({ tool, decision: "allow" })),
  ]
  const gated = guards.length > 0 ? new GuardedPermissions(modeAware, guards) : modeAware

  return new AuditingPermissions(gated, {
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
