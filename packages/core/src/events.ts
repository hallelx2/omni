import type { CumulativeUsage, FinishReason, ToolCall, ToolMeta, UsageDelta } from "./types.ts"
import type { ClassifiedError } from "./util/errors.ts"

/** Reason an `engine.run()` call terminated. */
export type DoneReason =
  | "model_done"
  | "max_iterations"
  | "aborted"
  | "loop_detected"
  | "fatal_error"

/**
 * Every observable thing the engine emits during a run. This is the only
 * public observation channel — the engine never logs or prints.
 *
 * Event ordering guarantees:
 *   - First event is always `engine.start`.
 *   - Last event is always `engine.done` (exactly once).
 *   - Each iteration: `engine.iteration` → `model.*` → optional `tool.*` events.
 *   - Each `tool.start` has exactly one terminal partner: `tool.result`, `tool.error`,
 *     `tool.invalid`, or `tool.permission_denied`.
 *
 * Discriminated by `type`. Filter with `events.filter(e => e.type === "model.delta")`.
 */
export type EngineEvent =
  // ── engine lifecycle ─────────────────────────────────────────────────────
  /** Emitted at the very start of `run()`. */
  | { readonly type: "engine.start"; readonly sessionId: string; readonly input: string }
  /** Emitted at the top of each iteration, before the model is called. */
  | { readonly type: "engine.iteration"; readonly iteration: number; readonly maxIterations: number }
  /** Terminal event. Exactly one per `run()` call. */
  | {
      readonly type: "engine.done"
      readonly reason: DoneReason
      readonly usage: CumulativeUsage
      readonly durationMs: number
    }
  /** Surfaces a fatal error from a non-retryable code path. */
  | { readonly type: "engine.error"; readonly error: ClassifiedError; readonly fatal: boolean }
  /** Emitted after each successful model call with its token usage delta. */
  | { readonly type: "engine.usage"; readonly delta: UsageDelta; readonly total: CumulativeUsage }
  /** Loop detector tripped: same tool-call set repeated `occurrences` times. */
  | {
      readonly type: "engine.loop_detected"
      readonly signature: string
      readonly occurrences: number
    }
  /** Retrying after a retryable model error. Attempt number is per-iteration. */
  | {
      readonly type: "engine.retrying"
      readonly attempt: number
      readonly delayMs: number
      readonly reason: string
    }
  /** Non-fatal warning (tracer throw, permission gate exception, etc.). */
  | {
      readonly type: "engine.warning"
      readonly category: "permission_gate" | "tracer" | "hook" | "other"
      readonly message: string
      readonly cause?: unknown
    }

  // ── model events ─────────────────────────────────────────────────────────
  /** Model call began. */
  | { readonly type: "model.start"; readonly modelId: string }
  /** Streaming assistant text chunk. */
  | { readonly type: "model.delta"; readonly text: string }
  /** Streaming reasoning text chunk (when supported). */
  | { readonly type: "model.thinking_delta"; readonly text: string }
  /** Model began composing a tool call (id known). */
  | { readonly type: "model.tool_call_start"; readonly call: ToolCall }
  /** Streamed args for a tool call already in progress. */
  | {
      readonly type: "model.tool_call_args_delta"
      readonly callId: string
      readonly argsDelta: string
    }
  /** Model completed a tool call proposal. */
  | { readonly type: "model.tool_call_done"; readonly call: ToolCall }
  /** Model finished its turn with a finish reason and optional usage. */
  | {
      readonly type: "model.done"
      readonly finishReason: FinishReason
      readonly usage?: UsageDelta
    }

  // ── tool events ──────────────────────────────────────────────────────────
  /** Engine is consulting the permission gate. Always emitted, even when auto-allowed. */
  | {
      readonly type: "tool.permission_requested"
      readonly call: ToolCall
      readonly tool: ToolMeta
    }
  /** Permission gate allowed the call. */
  | { readonly type: "tool.permission_granted"; readonly call: ToolCall }
  /** Permission gate refused the call; engine feeds an error back as a tool message. */
  | { readonly type: "tool.permission_denied"; readonly call: ToolCall }
  /** Tool call rejected before execution (unknown tool or invalid args). */
  | { readonly type: "tool.invalid"; readonly call: ToolCall; readonly reason: string }
  /** Tool execution began. */
  | { readonly type: "tool.start"; readonly call: ToolCall }
  /** Tool's `ctx.onProgress(msg)` callback. */
  | { readonly type: "tool.progress"; readonly call: ToolCall; readonly message: string }
  /** Tool execution succeeded. */
  | {
      readonly type: "tool.result"
      readonly call: ToolCall
      readonly result: unknown
      readonly durationMs: number
    }
  /** Tool execution threw. */
  | {
      readonly type: "tool.error"
      readonly call: ToolCall
      readonly error: ClassifiedError
      readonly durationMs: number
    }

  // ── verifier events ──────────────────────────────────────────────────────
  /** A verifier began checking a tool result. */
  | {
      readonly type: "verifier.start"
      readonly call: ToolCall
      readonly verifier: string
    }
  /** Long-running verifier progress update (test name being run, etc.). */
  | {
      readonly type: "verifier.progress"
      readonly call: ToolCall
      readonly verifier: string
      readonly message: string
    }
  /**
   * Terminal verifier event. `status` is "pass" | "fail" | "skip". On "fail"
   * the engine has already appended correction feedback to history so the
   * next iteration sees it; subscribers shouldn't duplicate that.
   */
  | {
      readonly type: "verifier.result"
      readonly call: ToolCall
      readonly verifier: string
      readonly status: "pass" | "fail" | "skip"
      readonly reason?: string
      readonly feedback?: string
      readonly durationMs: number
    }

  // ── context events ───────────────────────────────────────────────────────
  /** Context manager compacted history (e.g. summarization or window drop). */
  | {
      readonly type: "context.compacted"
      readonly messagesBefore: number
      readonly messagesAfter: number
    }
