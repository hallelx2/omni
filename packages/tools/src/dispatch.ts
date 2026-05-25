/**
 * `dispatch_agents` — fan several prebuilt subagents out in parallel and
 * collect their results. Built as a factory because it needs the live agent
 * registry (each agent is itself a Tool that runs a child engine).
 *
 * Concurrency: a bounded worker pool runs each agent tool's `execute()`
 * concurrently with Promise.allSettled-style isolation — one child failing or
 * aborting never sinks the others. The parent's `ctx.signal` is threaded into
 * every child, so aborting the parent cancels the whole fan-out.
 */
import { z } from "zod"
import type { Tool, ToolContext, SubagentResult } from "@omni/core"

export const MAX_AGENTS = 8
/** Per-child final-text cap so N children stay under the engine's 64KB tool-result budget. */
export const PER_CHILD_RESULT_BYTES = 6_000

export interface DispatchAgentItemResult {
  readonly agent: string
  readonly task: string
  /** True when the child finished normally (reason "model_done", no throw). */
  readonly ok: boolean
  readonly result: string
  readonly iterations: number
  readonly reason: string
  readonly tokensUsed: number
  readonly durationMs: number
  readonly error?: string
  readonly truncated?: boolean
}

export interface DispatchAgentsResult {
  readonly dispatched: number
  readonly succeeded: number
  readonly failed: number
  readonly aborted: boolean
  readonly totalTokensUsed: number
  readonly results: readonly DispatchAgentItemResult[]
}

export interface DispatchDeps {
  /** Resolve an agent name to its delegate tool, or undefined if unknown. */
  readonly getAgentTool: (name: string) => Tool<{ task: string }, SubagentResult> | undefined
  /** Names of all registered agents (for validation + the tool description). */
  readonly listAgents: () => readonly string[]
  /** Default concurrency cap when the call omits max_concurrency. */
  readonly defaultMaxConcurrency?: number
}

function clip(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  return { text: text.slice(0, max) + `\n…[truncated ${text.length - max} chars]`, truncated: true }
}

/** Bounded worker pool. `run` is expected not to throw (errors are mapped to items). */
async function runPool<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workerCount = Math.max(1, Math.min(limit, items.length))
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) break
      results[i] = await run(items[i]!, i)
    }
  })
  await Promise.all(workers)
  return results
}

export function makeDispatchAgentsTool(
  deps: DispatchDeps,
): Tool<{ tasks: { agent: string; task: string }[]; max_concurrency?: number }, DispatchAgentsResult> {
  const known = () => new Set(deps.listAgents())
  const DispatchArgs = z.object({
    tasks: z
      .array(
        z.object({
          agent: z.string().min(1).describe("Registered agent name (e.g. explore, test, critique)."),
          task: z.string().min(1).describe("Single focused task for that agent."),
        }),
      )
      .min(1)
      .max(MAX_AGENTS)
      .describe("Agents to run in parallel. Each runs independently; all results are collected."),
    max_concurrency: z
      .number()
      .int()
      .positive()
      .max(MAX_AGENTS)
      .optional()
      .describe("Cap on simultaneous agents (default: run all, up to 8)."),
  })

  return {
    name: "dispatch_agents",
    description:
      `Run several prebuilt subagents in parallel and collect all results when they finish. ` +
      `Use for independent subtasks (e.g. explore two areas at once, or explore + test). ` +
      `Available agents: ${deps.listAgents().join(", ") || "(none)"}.`,
    permission: "ask",
    schema: DispatchArgs,
    async execute(args, ctx: ToolContext): Promise<DispatchAgentsResult> {
      const names = known()
      const limit = args.max_concurrency ?? deps.defaultMaxConcurrency ?? args.tasks.length

      const results = await runPool(args.tasks, limit, async (item, index): Promise<DispatchAgentItemResult> => {
        const startedAt = Date.now()
        if (!names.has(item.agent)) {
          return {
            agent: item.agent,
            task: item.task,
            ok: false,
            result: "",
            iterations: 0,
            reason: "unknown_agent",
            tokensUsed: 0,
            durationMs: 0,
            error: `unknown agent "${item.agent}"; available: ${[...names].join(", ") || "(none)"}`,
          }
        }
        const tool = deps.getAgentTool(item.agent)!
        const childCtx: ToolContext = {
          cwd: ctx.cwd,
          env: ctx.env,
          signal: ctx.signal,
          onProgress: (line) => ctx.onProgress?.(`[${index}:${item.agent}] ${line}`),
        }
        try {
          const r = await tool.execute({ task: item.task }, childCtx)
          const clipped = clip(r.result ?? "", PER_CHILD_RESULT_BYTES)
          return {
            agent: item.agent,
            task: item.task,
            ok: r.reason === "model_done",
            result: clipped.text,
            iterations: r.iterations,
            reason: r.reason,
            tokensUsed: r.tokensUsed,
            durationMs: Date.now() - startedAt,
            truncated: clipped.truncated || undefined,
          }
        } catch (e) {
          return {
            agent: item.agent,
            task: item.task,
            ok: false,
            result: "",
            iterations: 0,
            reason: "error",
            tokensUsed: 0,
            durationMs: Date.now() - startedAt,
            error: e instanceof Error ? e.message : String(e),
          }
        }
      })

      return {
        dispatched: results.length,
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        aborted: ctx.signal.aborted,
        totalTokensUsed: results.reduce((sum, r) => sum + r.tokensUsed, 0),
        results,
      }
    },
  }
}
