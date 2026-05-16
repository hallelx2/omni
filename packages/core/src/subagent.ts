import { z } from "zod"
import type { Engine } from "./engine.ts"
import type { EngineEvent } from "./events.ts"
import type { Tool, ToolContext } from "./types.ts"

/**
 * Wrap an Engine as a Tool another Engine can invoke. Enables the
 * planner/executor split: a strong "planner" engine running on Claude/GPT
 * decomposes the task and delegates concrete sub-tasks to an "executor"
 * engine running a smaller open model.
 *
 * The child engine keeps its own permission gate, hooks, audit log, loop
 * detection, and snapshot/restore — none of those are bypassed by being
 * inside a tool call. The parent sees a single tool with one input field
 * (`task`) and gets the child's final assistant message back as `result`.
 *
 * Cancellation propagates through `ctx.signal`. Progress events from
 * inside the child (model deltas, tool starts) bubble up as
 * `ctx.onProgress(...)` so the parent surface can render a live preview.
 *
 * @example
 * ```ts
 * const executor = new Engine({ model: mimo(...), tools: [...], permissions: ask })
 * const planner = new Engine({
 *   model: anthropic(...),
 *   tools: [
 *     asSubagent(executor, {
 *       name: "execute",
 *       description: "Run one concrete sub-task on the local executor.",
 *     }),
 *   ],
 * })
 * await planner.run("refactor the auth module to use JWT")
 * ```
 */
export interface SubagentConfig {
  /** The tool name the parent model sees. */
  readonly name: string
  /** Human-readable description the model uses to decide when to delegate. */
  readonly description: string
  /**
   * Permission posture on the parent's gate. Default "ask" — delegating to a
   * sub-agent is consequential enough that humans usually want a checkpoint.
   */
  readonly permission?: "auto" | "ask" | "deny"
  /**
   * Optional progress decorator. The default surfaces the child's
   * model.delta and tool.* events as compact one-liners. Provide a custom
   * one to filter or reformat.
   */
  readonly onChildEvent?: (event: EngineEvent, emit: (line: string) => void) => void
  /**
   * History retention strategy across successive subagent invocations.
   *   - "isolate" (default): clear the child's history before each call.
   *     Each call is a fresh conversation; safest for context window.
   *   - "keep":    preserve everything. The child grows context turn-by-turn
   *     until its window overflows; useful for long-lived planning sessions.
   *   - { keepLast: N }: keep only the last N non-system messages of prior
   *     calls (system messages always preserved). A middle ground.
   */
  readonly history?: "isolate" | "keep" | { readonly keepLast: number }
}

export interface SubagentResult {
  /** The child's final assistant message text. */
  readonly result: string
  /** Number of iterations the child ran. */
  readonly iterations: number
  /** How the child terminated. */
  readonly reason: string
  /** Token usage attributed to the child run. */
  readonly tokensUsed: number
}

const SubagentArgs = z.object({
  task: z.string().min(1).describe("Single focused sub-task to delegate."),
})

/**
 * Build a Tool that delegates one task to a child Engine. Each invocation
 * runs `child.run(task)` and aggregates the result.
 *
 * Note: the child Engine is stateful — successive invocations share its
 * conversation history. If you want per-task isolation, construct a new
 * Engine per call (wrap a factory in your tool's execute).
 */
export function asSubagent(
  child: Engine,
  config: SubagentConfig,
): Tool<z.infer<typeof SubagentArgs>, SubagentResult> {
  return {
    name: config.name,
    description: config.description,
    permission: config.permission ?? "ask",
    schema: SubagentArgs,
    async execute(args, ctx: ToolContext): Promise<SubagentResult> {
      let iterations = 0
      let reason = "unknown"
      let tokensUsed = 0

      const defaultDecorator = (ev: EngineEvent, emit: (line: string) => void) => {
        if (ev.type === "engine.iteration") emit(`iter ${ev.iteration}`)
        else if (ev.type === "tool.start") emit(`→ ${ev.call.name}`)
        else if (ev.type === "model.delta" && ev.text.length > 0)
          emit(`… ${ev.text.replace(/\n+/g, " ").slice(0, 80)}`)
      }
      const decorate = config.onChildEvent ?? defaultDecorator
      const emit = (line: string) => ctx.onProgress?.(line)

      applyHistoryPolicy(child, config.history ?? "isolate")

      for await (const ev of child.run(args.task, { signal: ctx.signal })) {
        if (ev.type === "engine.iteration") iterations = ev.iteration
        if (ev.type === "engine.done") {
          reason = ev.reason
          tokensUsed = ev.usage.totalTokens
        }
        decorate(ev, emit)
      }

      const history = child.history()
      const lastAssistant = [...history].reverse().find((m) => m.role === "assistant")
      const text = lastAssistant?.content ?? ""

      return { result: text, iterations, reason, tokensUsed }
    },
  }
}

/**
 * Apply the configured history-retention policy before a subagent run.
 *   - "isolate": clear non-system messages; keep system messages intact.
 *   - "keep":    no-op.
 *   - {keepLast:N}: keep system + last N non-system messages.
 */
function applyHistoryPolicy(
  child: Engine,
  policy: NonNullable<SubagentConfig["history"]>,
): void {
  if (policy === "keep") return

  const snap = child.snapshot()
  const system = snap.messages.filter((m) => m.role === "system")
  let kept = system

  if (typeof policy === "object" && policy.keepLast > 0) {
    const rest = snap.messages.filter((m) => m.role !== "system")
    const tail = rest.slice(-policy.keepLast)
    kept = [...system, ...tail]
  }
  // "isolate" falls through with kept === system.

  child.restore({ ...snap, messages: kept })
}
