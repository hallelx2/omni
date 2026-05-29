/**
 * Session runtime — the brain behind the desktop server. Manages one shared
 * SQLite store, a project store, and a pool of live {@link Engine}s (one per
 * active session, built lazily with the project's cwd + resolved model).
 *
 * Unlike the CLI bootstrap (which is `process.cwd()`-bound and single-session),
 * this constructs each engine with an explicit `cwd` so many projects can be
 * open at once, and forwards interactive permission prompts to whichever socket
 * is driving the run.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { ulid } from "ulid"
import {
  Engine,
  AskPermissions,
  AllowAllPermissions,
  DenyAllPermissions,
  GuardedPermissions,
  AuditingPermissions,
  workspaceGuards,
  buildSystemPrompt,
  loadConfig,
  mergeConfigs,
  omniConfigPath,
  omniPaths,
  ensureOmniHome,
  resolveApiKey,
  resolveBaseURL,
  type Config,
  type Tool,
  type Verifier,
  type Message,
  type PermissionGate,
  type PermissionRule,
  type PermissionDecision,
  type CumulativeUsage,
  type AskHandler,
  type ModelAdapter,
  type EngineEvent,
} from "@omni/core"
import {
  MockAdapter,
  mimo,
  ollama,
  AnthropicAdapter,
  OpenAIAdapter,
  GoogleAdapter,
  type MockScript,
} from "@omni/adapters"
import {
  bash, readFile, writeFile, edit, multiEdit, applyPatch, glob, grep, webFetch,
  MCPManager, bashShell, setBashShellPref,
  PatchAppliesVerifier, FileParsesVerifier, TypecheckVerifier, TestVerifier,
} from "@omni/tools"
import {
  Storage, SessionsRepo, MessagesRepo, EventsRepo, AuditRepo, VariantsRepo,
  type SessionRow, type StoredMessage,
} from "@omni/storage"
import {
  adaptFromPool,
  poolFromRows,
  rowFromVariant,
  addVariant,
  emptyPool,
  mutatePrompt,
  scoreTrace,
  EVOLUTION_SEED,
  type ModelProfile,
} from "@omni/improve"
import { ProjectStore } from "./projects.ts"
import { defaultModelRef } from "./providers.ts"
import type { SessionSummary, ChatMessage, ServerMessage, UsageSummary } from "./protocol.ts"

const ZERO_USAGE: CumulativeUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  callCount: 0,
}

type Sink = (msg: ServerMessage) => void

interface LiveSession {
  id: string
  projectId: string
  projectPath: string
  engine: Engine
  adapter: ModelAdapter
  ac: AbortController
  persistedCount: number
  send: Sink | null
  running: boolean
  /** Evolve loop: the variant driving this session (null when disabled). */
  activeVariantId: string | null
  evolveEnabled: boolean
}

export interface RuntimeOptions {
  readonly permissionTimeoutMs?: number
  readonly serverVersion?: string
}

export class SessionRuntime {
  readonly storage: Storage
  readonly sessions: SessionsRepo
  readonly messages: MessagesRepo
  readonly events: EventsRepo
  readonly audit: AuditRepo
  readonly variants: VariantsRepo
  readonly projects: ProjectStore

  private userConfig: Config
  private readonly builtinTools: Tool[]
  private readonly mcp: MCPManager
  private mcpReady = false
  private readonly live = new Map<string, LiveSession>()
  private readonly pending = new Map<string, (d: PermissionDecision) => void>()
  private readonly permTimeoutMs: number

  constructor(opts: RuntimeOptions = {}) {
    ensureOmniHome()
    const paths = omniPaths()
    this.storage = new Storage(paths.db)
    this.sessions = new SessionsRepo(this.storage)
    this.messages = new MessagesRepo(this.storage)
    this.events = new EventsRepo(this.storage)
    this.audit = new AuditRepo(this.storage)
    this.variants = new VariantsRepo(this.storage)
    this.projects = new ProjectStore()
    this.userConfig = loadConfig(omniConfigPath())
    this.permTimeoutMs = opts.permissionTimeoutMs ?? 120_000
    this.builtinTools = [bash, readFile, writeFile, edit, multiEdit, applyPatch, glob, grep, webFetch]
    this.mcp = new MCPManager(this.userConfig.mcp?.servers ?? {})
  }

  async init(): Promise<void> {
    try {
      await this.mcp.connectAll()
      this.mcpReady = true
    } catch {
      this.mcpReady = false
    }
  }

  config(): Config {
    return this.userConfig
  }

  /** Re-read user config from disk after a settings save; evict idle engines so they rebuild. */
  reloadConfig(): Config {
    this.userConfig = loadConfig(omniConfigPath())
    for (const [id, live] of [...this.live]) {
      if (!live.running) this.live.delete(id)
    }
    return this.userConfig
  }

  /** Drop idle live engines for a project (e.g. after a model override change). */
  evictProject(projectId: string): void {
    for (const [id, live] of [...this.live]) {
      if (live.projectId === projectId && !live.running) this.live.delete(id)
    }
  }

  // ── Sessions (REST) ────────────────────────────────────────────────────────

  listSessions(projectId: string): SessionSummary[] {
    return this.sessions
      .list({ limit: 1000 })
      .filter((r) => (r.meta?.projectId as string | undefined) === projectId)
      .map((r) => this.toSummary(r))
  }

  createSession(projectId: string, title?: string): SessionSummary {
    const project = this.projects.get(projectId)
    if (!project) throw new Error(`unknown project: ${projectId}`)
    const effective = this.effectiveConfig(project.path)
    const modelRef = project.modelRef
    let modelId: string
    try {
      modelId = resolveAdapter(modelRef, effective).modelId
    } catch {
      modelId = modelRef ?? defaultModelRef(effective)
    }
    const id = ulid()
    this.sessions.create(id, modelId, {
      projectId,
      projectPath: project.path,
      title: title ?? "New session",
    })
    this.projects.touch(projectId)
    return this.toSummary(this.sessions.get(id)!)
  }

  getSessionDetail(id: string): { session: SessionSummary; messages: ChatMessage[] } | null {
    const row = this.sessions.get(id)
    if (!row) return null
    const messages = this.messages
      .bySession(id)
      .filter((m) => m.role !== "system")
      .map(toChatMessage)
    return { session: this.toSummary(row), messages }
  }

  renameSession(id: string, title: string): boolean {
    if (!this.sessions.get(id)) return false
    this.updateMeta(id, { title })
    return true
  }

  deleteSession(id: string): boolean {
    const live = this.live.get(id)
    if (live) {
      live.ac.abort()
      this.live.delete(id)
    }
    this.storage.db.query("DELETE FROM messages WHERE session_id = ?").run(id)
    this.storage.db.query("DELETE FROM events WHERE session_id = ?").run(id)
    return this.sessions.delete(id)
  }

  // ── Running (WebSocket) ──────────────────────────────────────────────────────

  async run(sessionId: string, input: string, send: Sink): Promise<void> {
    let live: LiveSession
    try {
      live = this.getOrCreateLive(sessionId, send)
    } catch (e) {
      send({ type: "error", sessionId, message: (e as Error).message })
      return
    }
    live.send = send
    live.ac = new AbortController()
    live.running = true

    // First message → kick off streaming title generation (and signal "naming…"
    // to the UI immediately by sending an empty title). Falls back to the input
    // snippet if generation fails.
    const row = this.sessions.get(sessionId)
    const isFirstMessage = !row?.meta?.title || row.meta?.title === "New session"
    if (isFirstMessage) {
      send({ type: "title", sessionId, title: "" })
      void this.generateTitleFor(sessionId, input, live)
    }
    this.sessions.setStatus(sessionId, "active")

    let failed = false
    try {
      for await (const ev of live.engine.run(input, { signal: live.ac.signal })) {
        send({ type: "event", sessionId, event: ev })
      }
    } catch (e) {
      failed = true
      send({ type: "error", sessionId, message: (e as Error).message })
    } finally {
      live.running = false
      this.persistNewMessages(live)
      this.updateMeta(sessionId, { usage: live.engine.usage() })
      this.sessions.setStatus(sessionId, failed ? "failed" : "completed")
      this.scoreEvolveTrial(live)
    }
  }

  /**
   * Close the self-improvement loop for a finished run: score this session's
   * trace (verifier-grounded) and fold it into the active variant, then
   * occasionally seed a mutated challenger. Best-effort — never throws.
   */
  private scoreEvolveTrial(live: LiveSession): void {
    if (!live.evolveEnabled) return
    try {
      const evs = this.events.bySession(live.id).map((r) => r.data as EngineEvent)
      if (evs.length === 0) return
      const score = scoreTrace(evs)
      if (live.activeVariantId) this.variants.recordTrial(live.activeVariantId, score)
      const cfg = this.userConfig.improve?.evolve
      if (Math.random() < (cfg?.mutationRate ?? 0.15)) {
        const top = this.variants.ranked(live.adapter.id)[0]
        if (top) {
          const childText = mutatePrompt(top.text)
          if (childText !== top.text) {
            const { variant } = addVariant(emptyPool(), childText, top.id)
            this.variants.upsert(rowFromVariant(live.adapter.id, variant))
          }
        }
      }
    } catch {
      // evolve scoring is best-effort
    }
  }

  abort(sessionId: string): void {
    this.live.get(sessionId)?.ac.abort()
  }

  respondPermission(requestId: string, decision: PermissionDecision): void {
    const resolver = this.pending.get(requestId)
    if (resolver) {
      this.pending.delete(requestId)
      resolver(decision)
    }
  }

  /** Cancel anything in flight on a socket that just disconnected. */
  detach(send: Sink): void {
    for (const live of this.live.values()) {
      if (live.send === send) {
        live.ac.abort()
        live.send = null
        live.running = false
      }
    }
  }

  async dispose(): Promise<void> {
    for (const live of this.live.values()) live.ac.abort()
    try {
      await this.mcp.closeAll()
    } catch {
      // ignore
    }
    this.storage.close()
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  private getOrCreateLive(sessionId: string, send: Sink): LiveSession {
    const existing = this.live.get(sessionId)
    if (existing) return existing

    const row = this.sessions.get(sessionId)
    if (!row) throw new Error(`unknown session: ${sessionId}`)
    const projectId = (row.meta?.projectId as string | undefined) ?? ""
    const project = this.projects.get(projectId)
    const projectPath = project?.path ?? (row.meta?.projectPath as string | undefined) ?? process.cwd()
    const config = this.effectiveConfig(projectPath)
    const modelRef = project?.modelRef ?? (row.meta?.modelRef as string | undefined)
    const { adapter } = resolveAdapter(modelRef, config)

    const live: LiveSession = {
      id: sessionId,
      projectId,
      projectPath,
      engine: undefined as unknown as Engine,
      adapter,
      ac: new AbortController(),
      persistedCount: 0,
      send,
      running: false,
      activeVariantId: null,
      evolveEnabled: false,
    }

    // ── Self-improvement loop selection (opt-in via config.improve.evolve) ─────
    // Mirrors the CLI bootstrap: hydrate+seed the model's variant pool and pick
    // an operating-rules variant to layer onto the base prompt. The desktop has
    // no probe, so a synthetic profile drives adaptFromPool — only the chosen
    // variant text/id is used (the static strategy is ignored here).
    let activeVariantText: string | null = null
    if (config.improve?.evolve?.enabled === true && adapter.id !== "mock") {
      try {
        let pool = poolFromRows(this.variants.forModel(adapter.id))
        if (pool.variants.length === 0) {
          const { variant } = addVariant(emptyPool(), EVOLUTION_SEED)
          this.variants.upsert(rowFromVariant(adapter.id, variant))
          pool = poolFromRows(this.variants.forModel(adapter.id))
        }
        const synthProfile: ModelProfile = {
          modelId: adapter.id,
          probedAt: 0,
          nativeToolCalls: true,
          followsInstructions: true,
          verboseByDefault: false,
          averageLatencyMs: 0,
          errorRate: 0,
          notes: [],
        }
        const sel = adaptFromPool(synthProfile, pool, {
          minTrials: config.improve.evolve.minTrials,
          explorationRate: config.improve.evolve.explorationRate,
          tournamentK: config.improve.evolve.tournamentK,
        })
        activeVariantText = sel.variant?.text ?? null
        live.activeVariantId = sel.variant?.id ?? null
        live.evolveEnabled = true
      } catch {
        // evolve is best-effort — never block session creation
      }
    }

    const tools: Tool[] = [...this.builtinTools, ...(this.mcpReady ? this.mcp.tools() : [])]
    const verifiers = buildVerifiers(config)
    setBashShellPref(config.bash?.shell)
    const shellInfo = bashShell()
    const systemPrompt =
      config.systemPrompt ??
      buildSystemPrompt({
        cwd: projectPath,
        shell: shellInfo.label,
        shellFamily: shellInfo.family,
        shellKind: shellInfo.kind,
        isGitRepo: existsSync(join(projectPath, ".git")),
        tools: tools.map((t) => ({ name: t.name, description: t.description })),
        verifiers: verifiers.map((v) => v.name),
        nativeToolCalls: true,
        verbose: false,
        extra: activeVariantText ?? undefined,
      })

    const engine = new Engine({
      model: adapter,
      tools,
      permissions: this.buildPermissions(config, live, projectPath, sessionId),
      systemPrompt,
      cwd: projectPath,
      // 0 = unbounded (matches the CLI). The engine's loop detection, the abort
      // button, and the iteration-budget reminder are the real stops; a hard 25
      // cap was cutting off legitimate from-scratch builds mid-task.
      maxIterations: config.maxIterations ?? 0,
      enableReActFallback: config.enableReActFallback ?? true,
      tracer: (event) => {
        this.events.append({ session_id: sessionId, t: Date.now(), type: event.type, data: event })
      },
      verifiers,
    })
    live.engine = engine

    const stored = this.messages.bySession(sessionId)
    if (stored.length > 0) {
      engine.restore({
        sessionId,
        messages: stored.map(toEngineMessage),
        usage: reconstructUsage(this.events, sessionId),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })
      live.persistedCount = stored.length
    } else {
      // Align the engine's session id with the row while keeping its fresh
      // system prompt; nothing persisted yet, so the system message will be
      // written on the first run.
      engine.restore({
        sessionId,
        messages: engine.history(),
        usage: ZERO_USAGE,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })
      live.persistedCount = 0
    }

    this.live.set(sessionId, live)
    return live
  }

  private buildPermissions(
    config: Config,
    live: LiveSession,
    root: string,
    sessionId: string,
  ): PermissionGate {
    const mode = config.permissions?.mode ?? "ask"
    const forward: AskHandler = async (tool, call) => {
      const send = live.send
      if (!send) return "deny"
      const requestId = ulid()
      send({
        type: "permission_request",
        sessionId: live.id,
        requestId,
        tool: { name: tool.name, description: tool.description },
        call,
      })
      return new Promise<PermissionDecision>((resolve) => {
        const timer = setTimeout(() => {
          this.pending.delete(requestId)
          resolve("deny")
        }, this.permTimeoutMs)
        this.pending.set(requestId, (d) => {
          clearTimeout(timer)
          resolve(d)
        })
      })
    }

    let base: PermissionGate
    if (mode === "allow_all") base = new AllowAllPermissions()
    else if (mode === "deny_all") base = new DenyAllPermissions()
    else base = new AskPermissions(forward)

    const perms = config.permissions ?? {}
    const guards: PermissionRule[] = [
      ...workspaceGuards({
        denyDestructiveBash: perms.denyDestructive !== false,
        restrictToRoot: perms.restrictToWorkspace === true,
        root,
      }),
      ...(perms.autoAllow ?? []).map((tool): PermissionRule => ({ tool, decision: "allow" })),
      ...(mode === "rules" ? parseConfigRules(perms.rules) : []),
    ]
    const gated = guards.length > 0 ? new GuardedPermissions(base, guards) : base

    return new AuditingPermissions(
      gated,
      {
        record: (entry) => {
          this.audit.append({
            session_id: entry.sessionId || undefined,
            tool: entry.toolName,
            decision: entry.decision,
            args: entry.call.args,
            timestamp: entry.timestamp,
          })
        },
      },
      sessionId,
    )
  }

  private persistNewMessages(live: LiveSession): void {
    const hist = live.engine.history()
    for (let i = live.persistedCount; i < hist.length; i++) {
      const m = hist[i]!
      try {
        this.messages.append({
          id: m.id,
          session_id: live.id,
          role: m.role,
          content: m.content,
          tool_calls: m.toolCalls?.map((c) => ({ id: c.id, name: c.name, args: c.args })),
          tool_call_id: m.toolCallId,
          metadata: m.metadata,
          timestamp: m.timestamp,
        })
      } catch {
        // Duplicate id (already persisted) — skip.
      }
    }
    live.persistedCount = hist.length
  }

  /** Per-project effective config: user config merged with the project's `.omni/config.json`. */
  private effectiveConfig(projectPath: string): Config {
    const wsConfig = join(projectPath, ".omni", "config.json")
    if (existsSync(wsConfig)) {
      try {
        return mergeConfigs(this.userConfig, loadConfig(wsConfig))
      } catch {
        return this.userConfig
      }
    }
    return this.userConfig
  }

  private maybeTitle(sessionId: string, input: string): void {
    const row = this.sessions.get(sessionId)
    const current = row?.meta?.title as string | undefined
    if (!current || current === "New session") {
      const title = input.trim().replace(/\s+/g, " ").slice(0, 60) || "New session"
      this.updateMeta(sessionId, { title })
    }
  }

  private updateMeta(id: string, patch: Record<string, unknown>): void {
    const row = this.sessions.get(id)
    if (!row) return
    const meta = { ...(row.meta ?? {}), ...patch }
    this.storage.db
      .query("UPDATE sessions SET meta_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(meta), Date.now(), id)
  }

  /** Stream a short LLM-generated title from the first user message. */
  private async generateTitleFor(sessionId: string, input: string, live: LiveSession): Promise<void> {
    const ac = new AbortController()
    let acc = ""
    try {
      const now = Date.now()
      const messages: Message[] = [
        { id: ulid(), role: "system", content: TITLE_SYSTEM_PROMPT, timestamp: now },
        { id: ulid(), role: "user", content: input.slice(0, 1200), timestamp: now + 1 },
      ]
      for await (const ev of live.adapter.complete({
        messages,
        tools: [],
        maxTokens: 32,
        temperature: 0.3,
        signal: ac.signal,
      })) {
        if (ev.type === "delta" && typeof ev.text === "string" && ev.text) {
          acc += ev.text
          live.send?.({ type: "title", sessionId, title: cleanTitle(acc) })
        } else if (ev.type === "done") {
          break
        }
      }
    } catch {
      // fall through — fallback below
    }
    const final = cleanTitle(acc) || fallbackTitle(input)
    this.updateMeta(sessionId, { title: final })
    live.send?.({ type: "title", sessionId, title: final })
  }

  private toSummary(row: SessionRow): SessionSummary {
    const meta = row.meta ?? {}
    const usage = (meta.usage as UsageSummary | undefined) ?? toUsageSummary(reconstructUsage(this.events, row.id))
    return {
      id: row.id,
      projectId: (meta.projectId as string | undefined) ?? "",
      title: (meta.title as string | undefined) ?? "Untitled",
      modelId: row.model_id,
      status: row.status,
      messageCount: this.messages.countBySession(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      usage,
    }
  }
}

// ── Adapter resolution ────────────────────────────────────────────────────────

export function resolveAdapter(
  ref: string | undefined,
  config: Config,
): { adapter: ModelAdapter; modelId: string } {
  let provider: string
  let model: string | undefined
  if (ref && ref.includes(":")) {
    const i = ref.indexOf(":")
    provider = ref.slice(0, i)
    model = ref.slice(i + 1)
  } else {
    provider = (config.adapter ?? (resolveApiKey("mimo", config) ? "mimo" : "mock")).toLowerCase()
    model = config.model
  }

  switch (provider) {
    case "anthropic": {
      const apiKey = resolveApiKey("anthropic", config)
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set — add it in Settings → Providers.")
      const m = model ?? "claude-sonnet-4-6"
      return {
        adapter: new AnthropicAdapter({ apiKey, model: m, baseURL: resolveBaseURL("anthropic", config) }),
        modelId: `anthropic:${m}`,
      }
    }
    case "openai": {
      const apiKey = resolveApiKey("openai", config)
      if (!apiKey) throw new Error("OPENAI_API_KEY not set — add it in Settings → Providers.")
      const m = model ?? "gpt-4o-mini"
      return {
        adapter: new OpenAIAdapter({ apiKey, model: m, baseURL: resolveBaseURL("openai", config) }),
        modelId: `openai:${m}`,
      }
    }
    case "google": {
      const apiKey = resolveApiKey("google", config)
      if (!apiKey) throw new Error("GOOGLE_API_KEY not set — add it in Settings → Providers.")
      const m = model ?? "gemini-2.0-flash"
      return { adapter: new GoogleAdapter({ apiKey, model: m }), modelId: `google:${m}` }
    }
    case "mimo": {
      const apiKey = resolveApiKey("mimo", config)
      if (!apiKey) throw new Error("MIMO_API_KEY not set — add it in Settings → Providers.")
      const m = model ?? "mimo-v2.5-pro"
      return {
        adapter: mimo({ apiKey, model: m, baseURL: resolveBaseURL("mimo", config) }),
        modelId: `mimo:${m}`,
      }
    }
    case "ollama": {
      const m = model ?? "qwen2.5-coder:7b"
      return {
        adapter: ollama({ model: m, baseURL: resolveBaseURL("ollama", config) }),
        modelId: `ollama:${m}`,
      }
    }
    case "mock":
    default: {
      const script: MockScript[] = [
        {
          kind: "text",
          text:
            "You're talking to the offline **Mock** model — no API key is configured, " +
            "so this is a canned reply. Open Settings → Providers, add a key (Anthropic, " +
            "OpenAI, Google, MiMo) or point at a local Ollama, then pick a model to chat for real.",
        },
      ]
      return { adapter: new MockAdapter({ script, deltaMs: 6 }), modelId: "mock" }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseConfigRules(
  rules: ReadonlyArray<{ tool: string; decision: PermissionDecision; argsInclude?: string }> | undefined,
): PermissionRule[] {
  if (!rules) return []
  return rules.map((r) => {
    let tool: string | RegExp = r.tool
    const m = /^\/(.*)\/([a-z]*)$/.exec(r.tool)
    if (m) {
      try {
        tool = new RegExp(m[1]!, m[2])
      } catch {
        tool = r.tool
      }
    }
    const needle = r.argsInclude
    const when = needle
      ? (args: unknown) => {
          try {
            return JSON.stringify(args ?? "").includes(needle)
          } catch {
            return false
          }
        }
      : undefined
    return { tool, when, decision: r.decision }
  })
}

function buildVerifiers(config: Config): Verifier[] {
  const out: Verifier[] = []
  const v = config.verifiers
  if (!v?.disableBuiltins) out.push(new PatchAppliesVerifier(), new FileParsesVerifier())
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

function toEngineMessage(m: StoredMessage): Message {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    toolCalls: m.tool_calls?.map((c) => ({ id: c.id, name: c.name, args: c.args })),
    toolCallId: m.tool_call_id,
    metadata: m.metadata,
    timestamp: m.timestamp,
  }
}

function toChatMessage(m: StoredMessage): ChatMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    toolCalls: m.tool_calls?.map((c) => ({ id: c.id, name: c.name, args: c.args })),
    toolCallId: m.tool_call_id,
    timestamp: m.timestamp,
  }
}

function toUsageSummary(u: CumulativeUsage): UsageSummary {
  return {
    promptTokens: u.promptTokens,
    completionTokens: u.completionTokens,
    totalTokens: u.totalTokens,
    callCount: u.callCount,
    costUsd: u.costUsd,
  }
}

function reconstructUsage(events: EventsRepo, sessionId: string): CumulativeUsage {
  const stored = events.bySession(sessionId)
  for (let i = stored.length - 1; i >= 0; i--) {
    const ev = stored[i]!
    if (ev.type === "engine.usage") {
      const d = ev.data as { total?: unknown }
      if (d && typeof d === "object" && d.total && typeof d.total === "object") {
        const t = d.total as Record<string, unknown>
        return {
          promptTokens: numberOr(t.promptTokens),
          completionTokens: numberOr(t.completionTokens),
          totalTokens: numberOr(t.totalTokens),
          callCount: numberOr(t.callCount),
          costUsd: typeof t.costUsd === "number" ? t.costUsd : undefined,
        }
      }
    }
  }
  return ZERO_USAGE
}

function numberOr(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback
}

const TITLE_SYSTEM_PROMPT =
  "You write very short titles for an AI coding agent's chat sessions. " +
  "Given the user's first message, reply with ONLY a 3 to 5 word Title Case title " +
  "that summarises the task. No quotes, no trailing punctuation, no leading filler " +
  "words like 'Task', 'Session', or 'Help'."

function cleanTitle(s: string): string {
  return s
    .replace(/^["'`*_\-\s]+|["'`.!?,;:*_\-\s]+$/g, "")
    .replace(/\s+/g, " ")
    .split("\n")[0]!
    .trim()
    .slice(0, 80)
}

function fallbackTitle(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, " ")
  return trimmed.split(" ").slice(0, 6).join(" ").slice(0, 60) || "New session"
}
