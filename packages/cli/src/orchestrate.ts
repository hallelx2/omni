/**
 * Shared turn orchestration used by BOTH surfaces (plain REPL + TUI), so the
 * planner-before / critic-after logic and the mode/skill tool composition live
 * in exactly one place.
 *
 *   plan mode  → restrict to read-only tools + run the Planner first
 *   build mode → full tools + run the Critic after the turn
 *
 * Planner/Critic run in TEXT mode (no adapter exposes an AI SDK LanguageModelV2
 * yet); both classes fall back to text automatically when no `languageModel`
 * is supplied. Any planner/critic failure is non-fatal — the turn still runs.
 */
import type { Engine, EngineEvent, Tool, ToolMeta } from "@omni/core"
import {
  renderPlan,
  filterToolsBySkill,
  type Planner,
  type Critic,
  type Plan,
  type Critique,
  type Skill,
} from "@omni/improve"
import { PLAN_MODE_TOOLS, type RunMode } from "./mode.ts"

export interface OrchestrationDeps {
  readonly engine: Engine
  readonly tools: readonly Tool[]
  readonly planner: Planner | null
  readonly critic: Critic | null
  /** Feed a failing critique back as one follow-up turn. Default false. */
  readonly criticAutoRetry?: boolean
  readonly fileTracer?: { record(ev: EngineEvent): void } | null
  /**
   * Recall long-term memory relevant to the turn's input, rendered as a
   * system-prompt block (or null when nothing is relevant). Omitted when memory
   * is disabled. The closure owns its own error handling — it must not throw.
   */
  readonly recallMemory?: (input: string) => Promise<string | null>
  /**
   * The active prompt-evolution variant's operating-rules text, layered as the
   * first block of the per-run system prefix (on top of the engine's
   * environment-aware base prompt). Null/omitted when evolution is off.
   */
  readonly activeVariantText?: string | null
}

export interface TurnContext {
  readonly mode: RunMode
  readonly activeSkill: Skill | null
  /** Probed strategy flags; planner/critic also fire when these are set. */
  readonly strategy: { readonly usePlanner: boolean; readonly useCritic: boolean } | null
  readonly signal: AbortSignal
}

export interface OrchestrationSink {
  onEngineEvent(ev: EngineEvent): void
  onPlan?(plan: Plan): void
  onCritique?(critique: Critique, willRetry: boolean): void
  onInfo?(text: string, tone?: "info" | "warn" | "error" | "dim"): void
}

/**
 * Compute the tool allowlist for a turn:
 *   - build + no skill   → undefined (all tools)
 *   - build + skill      → the skill's tool subset
 *   - plan  + no skill   → PLAN_MODE_TOOLS (read-only ceiling)
 *   - plan  + skill      → PLAN_MODE_TOOLS ∩ skill (skill can only narrow)
 */
export function computeEnabledTools(
  mode: RunMode,
  tools: readonly Tool[],
  activeSkill: Skill | null,
): ReadonlySet<string> | undefined {
  const skillNames = activeSkill?.toolsOnly
    ? new Set(filterToolsBySkill(tools, activeSkill).map((t) => t.name))
    : null

  if (mode === "plan") {
    if (!skillNames) return PLAN_MODE_TOOLS
    const out = new Set<string>()
    for (const n of skillNames) if (PLAN_MODE_TOOLS.has(n)) out.add(n)
    out.add("request_build_mode") // always allow the escape hatch out of plan mode
    return out
  }
  return skillNames ?? undefined
}

/** Join recalled-memory, planner directive, and skill prompt into one system prefix. */
export function composeSystemPrefix(
  ...blocks: (string | null | undefined)[]
): string | undefined {
  const parts = blocks.filter(
    (p): p is string => typeof p === "string" && p.trim().length > 0,
  )
  return parts.length > 0 ? parts.join("\n\n") : undefined
}

/** Run one orchestrated turn, pushing everything through the surface's sink. */
export async function runTurn(
  deps: OrchestrationDeps,
  input: string,
  turn: TurnContext,
  sink: OrchestrationSink,
): Promise<void> {
  const enabledTools = computeEnabledTools(turn.mode, deps.tools, turn.activeSkill)

  // ── pre: planner ──────────────────────────────────────────────────────────
  let plannerBlock: string | null = null
  const wantPlanner = turn.mode === "plan" || turn.strategy?.usePlanner === true
  if (wantPlanner && deps.planner) {
    try {
      const toolMeta: ToolMeta[] = deps.tools
        .filter((t) => !enabledTools || enabledTools.has(t.name))
        .map((t) => ({ name: t.name, description: t.description, permission: t.permission }))
      const plan = await deps.planner.plan(input, toolMeta)
      if (plan.steps.length > 0) {
        sink.onPlan?.(plan)
        plannerBlock = renderPlan(plan)
      }
    } catch (e) {
      sink.onInfo?.(`planner skipped: ${e instanceof Error ? e.message : String(e)}`, "warn")
    }
  }

  // ── pre: memory recall (auto-injected as a system block) ───────────────────
  let memoryBlock: string | null = null
  if (deps.recallMemory) {
    try {
      memoryBlock = await deps.recallMemory(input)
      if (memoryBlock) sink.onInfo?.("recalled long-term memory", "dim")
    } catch {
      // recall is best-effort; never block the turn
    }
  }

  const systemPromptPrefix = composeSystemPrefix(
    deps.activeVariantText ?? null,
    memoryBlock,
    plannerBlock,
    turn.activeSkill?.systemPrompt ?? null,
  )

  // ── run ─────────────────────────────────────────────────────────────────--
  const runOpts: {
    signal: AbortSignal
    systemPromptPrefix?: string
    enabledTools?: ReadonlySet<string>
  } = { signal: turn.signal }
  if (systemPromptPrefix) runOpts.systemPromptPrefix = systemPromptPrefix
  if (enabledTools) runOpts.enabledTools = enabledTools

  for await (const ev of deps.engine.run(input, runOpts)) {
    sink.onEngineEvent(ev)
    deps.fileTracer?.record(ev)
  }

  // ── post: critic ────────────────────────────────────────────────────────--
  if (turn.signal.aborted) return
  const wantCritic = turn.mode === "build" || turn.strategy?.useCritic === true
  if (wantCritic && deps.critic) {
    try {
      const critique = await deps.critic.reviewMessages(deps.engine.history())
      const willRetry = (deps.criticAutoRetry ?? false) && deps.critic.shouldRetry(critique)
      sink.onCritique?.(critique, willRetry)
      if (willRetry) {
        const followup =
          `A reviewer flagged issues with the previous response:\n- ${critique.issues.join("\n- ")}\n` +
          `Address them concretely.`
        // One-shot retry: disable critic + planner so we can't loop.
        await runTurn(
          { ...deps, critic: null },
          followup,
          { ...turn, strategy: { usePlanner: false, useCritic: false } },
          sink,
        )
      }
    } catch (e) {
      sink.onInfo?.(`critic skipped: ${e instanceof Error ? e.message : String(e)}`, "warn")
    }
  }
}
