import type { Tool, ToolCall, ToolContext, Message } from "./types.ts"
import type { ClassifiedError } from "./util/errors.ts"

/**
 * The lifecycle events that hooks can subscribe to.
 *
 * - `preToolUse`     — before a validated, permission-approved tool runs.
 *                      Hook can `continue: false` to block, or return `args`
 *                      to rewrite the input. Useful for redaction, dry-run
 *                      guards, command logging.
 * - `postToolUse`    — after a tool succeeded. Hook can return `result` to
 *                      replace the tool's output before it's appended to
 *                      history. Useful for summarising, redacting, prettifying.
 * - `preModel`       — before each model call. Hook can return `messages`
 *                      to rewrite the request body. Useful for injecting
 *                      context (current branch, time of day, etc.).
 * - `onError`        — when a classified, non-retryable error occurs. Hook
 *                      can return `handled: true` to suppress the engine's
 *                      fatal-error path.
 * - `onSessionStart` — at the top of the very first run on this engine.
 * - `onSessionEnd`   — at termination of any run with a final reason.
 */
export type HookEvent =
  | "preToolUse"
  | "postToolUse"
  | "preModel"
  | "onError"
  | "onSessionStart"
  | "onSessionEnd"

export interface PreToolUseResult {
  /** When false, the engine treats this as a permission denial. */
  readonly continue?: false
  /** Optional rewrite of the tool call's args. */
  readonly args?: unknown
  /** Free-form reason surfaced in the resulting event. */
  readonly reason?: string
}

export interface PostToolUseResult {
  /** Replacement result. The engine appends this to history instead of the original. */
  readonly result?: unknown
}

export interface PreModelResult {
  /** Replacement message list for THIS model call only. */
  readonly messages?: readonly Message[]
}

export interface OnErrorResult {
  /** When true, the engine suppresses its fatal-error path. */
  readonly handled?: boolean
}

/**
 * A hook module. Implement any subset of the lifecycle methods. Each method
 * is awaited; long hooks delay the engine, so keep them quick.
 *
 * @example
 * ```ts
 * export default {
 *   name: "redact-secrets",
 *   preToolUse: async (tool, call) => {
 *     if (tool.name !== "bash") return
 *     const cmd = (call.args as { command: string }).command
 *     return { args: { ...call.args, command: cmd.replace(/Bearer \S+/g, "Bearer [REDACTED]") } }
 *   },
 * } satisfies HookModule
 * ```
 */
export interface HookModule {
  readonly name: string
  preToolUse?: (
    tool: Tool,
    call: ToolCall,
    ctx: ToolContext,
  ) => Promise<PreToolUseResult | void>
  postToolUse?: (
    tool: Tool,
    call: ToolCall,
    result: unknown,
    ctx: ToolContext,
  ) => Promise<PostToolUseResult | void>
  preModel?: (messages: readonly Message[]) => Promise<PreModelResult | void>
  onError?: (error: ClassifiedError, info: { sessionId: string }) => Promise<OnErrorResult | void>
  onSessionStart?: (sessionId: string) => Promise<void>
  onSessionEnd?: (sessionId: string, reason: string) => Promise<void>
}

/**
 * Run every registered preToolUse hook in registration order. Returns the
 * first hook's response that blocks or rewrites args; subsequent hooks
 * see the prior rewrite. Returns `null` when no hook intervened.
 */
export async function runPreToolUse(
  hooks: readonly HookModule[],
  tool: Tool,
  call: ToolCall,
  ctx: ToolContext,
): Promise<PreToolUseResult | null> {
  let current = call
  let lastResult: PreToolUseResult | null = null
  for (const h of hooks) {
    if (!h.preToolUse) continue
    let r: PreToolUseResult | void
    try {
      r = await h.preToolUse(tool, current, ctx)
    } catch {
      continue
    }
    if (!r) continue
    if (r.continue === false) return r
    if (r.args !== undefined) {
      current = { ...current, args: r.args }
      lastResult = { args: r.args, reason: r.reason }
    }
  }
  return lastResult
}

export async function runPostToolUse(
  hooks: readonly HookModule[],
  tool: Tool,
  call: ToolCall,
  result: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  let current = result
  for (const h of hooks) {
    if (!h.postToolUse) continue
    try {
      const r = await h.postToolUse(tool, call, current, ctx)
      if (r && r.result !== undefined) current = r.result
    } catch {
      // ignore hook failures
    }
  }
  return current
}

export async function runPreModel(
  hooks: readonly HookModule[],
  messages: readonly Message[],
): Promise<readonly Message[]> {
  let current = messages
  for (const h of hooks) {
    if (!h.preModel) continue
    try {
      const r = await h.preModel(current)
      if (r && r.messages) current = r.messages
    } catch {
      // ignore
    }
  }
  return current
}

export async function runOnError(
  hooks: readonly HookModule[],
  error: ClassifiedError,
  info: { sessionId: string },
): Promise<boolean> {
  for (const h of hooks) {
    if (!h.onError) continue
    try {
      const r = await h.onError(error, info)
      if (r && r.handled) return true
    } catch {
      // ignore
    }
  }
  return false
}

export async function runOnSessionStart(
  hooks: readonly HookModule[],
  sessionId: string,
): Promise<void> {
  for (const h of hooks) {
    if (!h.onSessionStart) continue
    try {
      await h.onSessionStart(sessionId)
    } catch {
      // ignore
    }
  }
}

export async function runOnSessionEnd(
  hooks: readonly HookModule[],
  sessionId: string,
  reason: string,
): Promise<void> {
  for (const h of hooks) {
    if (!h.onSessionEnd) continue
    try {
      await h.onSessionEnd(sessionId, reason)
    } catch {
      // ignore
    }
  }
}
