/**
 * Runtime side of prebuilt subagents: turning an {@link Agent} definition into
 * a live child {@link Engine} (with its own model, tool subset, and enforced
 * permission gate) and exposing it to the parent as a delegate Tool.
 *
 * Adapter construction lives here (in the CLI) rather than in `@omni/improve`,
 * which must not depend on `@omni/adapters`.
 */
import { z } from "zod"
import {
  Engine,
  asSubagent,
  resolveApiKey,
  resolveBaseURL,
  type Config,
  type ModelAdapter,
  type Tool,
  type ToolContext,
  type SubagentResult,
} from "@omni/core"
import {
  mimo,
  ollama,
  AnthropicAdapter,
  OpenAIAdapter,
  GoogleAdapter,
} from "@omni/adapters"
import { agentPermissionGate, type Agent } from "@omni/improve"

// ─── Adapter resolution (per-agent / per-planner / per-critic models) ────────

export type AdapterProvider =
  | "mock"
  | "mimo"
  | "mimo-anthropic"
  | "ollama"
  | "anthropic"
  | "openai"
  | "google"

type RealProvider = Exclude<AdapterProvider, "mock">

const KNOWN_PROVIDERS = new Set<AdapterProvider>([
  "mock",
  "mimo",
  "mimo-anthropic",
  "ollama",
  "anthropic",
  "openai",
  "google",
])

const DEFAULT_MODEL: Readonly<Record<RealProvider, string>> = {
  mimo: "mimo-v2.5-pro",
  "mimo-anthropic": "mimo-v2.5-pro",
  ollama: "qwen2.5-coder:7b",
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o-mini",
  google: "gemini-2.0-flash",
}

/**
 * Construct a single adapter for a known provider. Throws when a required API
 * key is missing (callers that want a soft failure use {@link resolveAdapter}).
 * Shared by bootstrap's `pickAdapter` and by per-agent model resolution.
 */
export function constructAdapter(
  provider: RealProvider,
  model: string | undefined,
  config: Config,
): ModelAdapter {
  const m = model ?? DEFAULT_MODEL[provider]
  switch (provider) {
    case "mimo": {
      const apiKey = resolveApiKey("mimo", config)
      if (!apiKey) throw new Error("MIMO_API_KEY missing")
      return mimo({ apiKey, model: m, baseURL: resolveBaseURL("mimo", config) })
    }
    case "mimo-anthropic": {
      const apiKey = resolveApiKey("mimo-anthropic", config)
      if (!apiKey) throw new Error("MIMO_API_KEY missing")
      return new AnthropicAdapter({ apiKey, model: m, baseURL: resolveBaseURL("mimo-anthropic", config) })
    }
    case "ollama":
      return ollama({ model: m, baseURL: resolveBaseURL("ollama", config) })
    case "anthropic": {
      const apiKey = resolveApiKey("anthropic", config)
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing")
      return new AnthropicAdapter({ apiKey, model: m, baseURL: resolveBaseURL("anthropic", config) })
    }
    case "openai": {
      const apiKey = resolveApiKey("openai", config)
      if (!apiKey) throw new Error("OPENAI_API_KEY missing")
      return new OpenAIAdapter({ apiKey, model: m, baseURL: resolveBaseURL("openai", config) })
    }
    case "google": {
      const apiKey = resolveApiKey("google", config)
      if (!apiKey) throw new Error("GOOGLE_API_KEY missing")
      return new GoogleAdapter({ apiKey, model: m })
    }
  }
}

export interface ResolveAdapterDeps {
  readonly config: Config
  /** Returned when the ref is empty, points at "mock", or can't be built. */
  readonly fallback: ModelAdapter
  readonly warn?: (msg: string) => void
  /** Optional shared cache so repeated refs reuse one adapter. */
  readonly cache?: Map<string, ModelAdapter>
}

function inferProvider(config: Config): AdapterProvider {
  const which = process.env.OMNI_ADAPTER ?? config.adapter ?? (resolveApiKey("mimo", config) ? "mimo" : "mock")
  return KNOWN_PROVIDERS.has(which as AdapterProvider) ? (which as AdapterProvider) : "mock"
}

function parseModelRef(ref: string, config: Config): { provider: AdapterProvider; model: string | undefined } {
  const idx = ref.indexOf(":")
  if (idx > 0) {
    const maybe = ref.slice(0, idx)
    if (KNOWN_PROVIDERS.has(maybe as AdapterProvider)) {
      return { provider: maybe as AdapterProvider, model: ref.slice(idx + 1) || undefined }
    }
  }
  return { provider: inferProvider(config), model: ref }
}

/**
 * Resolve a "provider:model" (or bare model) reference into an adapter. Never
 * throws: a missing key, unknown provider, or "mock" ref yields the fallback
 * (the main model) plus a warning. Results are cached when a cache is provided.
 */
export function resolveAdapter(modelRef: string | undefined, deps: ResolveAdapterDeps): ModelAdapter {
  if (!modelRef || modelRef.trim() === "") return deps.fallback
  const cached = deps.cache?.get(modelRef)
  if (cached) return cached

  const { provider, model } = parseModelRef(modelRef, deps.config)
  let adapter: ModelAdapter
  if (provider === "mock") {
    adapter = deps.fallback
  } else {
    try {
      adapter = constructAdapter(provider, model, deps.config)
    } catch (e) {
      deps.warn?.(`agent model "${modelRef}" unavailable (${(e as Error).message}); using main model`)
      adapter = deps.fallback
    }
  }
  deps.cache?.set(modelRef, adapter)
  return adapter
}

/**
 * Decide whether a planner/critic should use structured output (generateObject)
 * for a given model. It needs the adapter to expose an AI SDK `languageModel`.
 * For the MAIN model we trust the probe's `supportsStructuredOutput`; for
 * per-role overrides (typically frontier models) we enable it and lean on the
 * planner/critic's automatic text fallback if the model can't comply.
 */
export function structuredConfigFor(
  model: ModelAdapter,
  opts: { isMain: boolean; mainSupportsStructured?: boolean },
): { useStructuredOutput: boolean; languageModel?: unknown } {
  const lm = model.languageModel?.()
  if (!lm) return { useStructuredOutput: false }
  const ok = opts.isMain ? opts.mainSupportsStructured ?? true : true
  return ok ? { useStructuredOutput: true, languageModel: lm } : { useStructuredOutput: false }
}

// ─── Child-engine factory + delegate tool ────────────────────────────────────

export interface BuildAgentDeps {
  /** Base tool list children may draw from (MUST exclude agent + dispatch tools). */
  readonly tools: readonly Tool[]
  readonly config: Config
  /** Resolve an agent's model ref to an adapter (closes over fallback + cache). */
  readonly resolveModel: (ref?: string) => ModelAdapter
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
}

/**
 * Build a fresh child Engine for an agent: its tool subset, its own model, and
 * a real {@link agentPermissionGate}. A fresh instance per call keeps
 * concurrent invocations of the same agent fully isolated.
 */
export function buildAgentEngine(agent: Agent, deps: BuildAgentDeps): Engine {
  const tools = agent.tools
    ? deps.tools.filter((t) => agent.tools!.includes(t.name))
    : deps.tools
  return new Engine({
    model: deps.resolveModel(agent.model),
    tools,
    permissions: agentPermissionGate(agent),
    systemPrompt: agent.systemPrompt,
    maxIterations: agent.maxIterations ?? deps.config.maxIterations ?? 12,
    cwd: deps.cwd,
    env: deps.env,
    enableReActFallback: deps.config.enableReActFallback ?? true,
  })
}

/** Tool-name-safe form of an agent name. */
export function agentToolName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_-]+/g, "_")
}

const AgentTaskArgs = z.object({
  task: z.string().min(1).describe("Single focused task to delegate to this subagent."),
})

/**
 * Wrap an agent as a delegate Tool the parent model can call. Each call builds
 * a fresh child engine (via {@link buildAgentEngine}) and runs it through
 * {@link asSubagent}, so the same agent can be dispatched in parallel safely.
 */
export function makeAgentTool(agent: Agent, deps: BuildAgentDeps): Tool<{ task: string }, SubagentResult> {
  const toolName = agentToolName(agent.name)
  return {
    name: toolName,
    description: `Delegate a focused task to the '${agent.name}' subagent. ${agent.description}`,
    permission: "ask",
    schema: AgentTaskArgs,
    async execute(args, ctx: ToolContext): Promise<SubagentResult> {
      const engine = buildAgentEngine(agent, deps)
      const wrapped = asSubagent(engine, {
        name: toolName,
        description: agent.description,
        permission: "auto",
        history: agent.history ?? "isolate",
        // Emit a clean, low-spam activity trace so a surface can "peep" into the
        // running subagent: one line per iteration + tool start/finish, and the
        // terminal reason. (The default decorator streams every model.delta,
        // which floods the log — we deliberately skip those.)
        onChildEvent: (childEv, emit) => {
          if (childEv.type === "engine.iteration") emit(`iter ${childEv.iteration}`)
          else if (childEv.type === "tool.start") emit(`→ ${childEv.call.name}`)
          else if (childEv.type === "tool.result") emit(`✓ ${childEv.call.name}`)
          else if (childEv.type === "tool.error") emit(`✗ ${childEv.call.name}`)
          else if (childEv.type === "engine.done") emit(`done · ${childEv.reason}`)
        },
      })
      return wrapped.execute(args, ctx)
    },
  }
}
