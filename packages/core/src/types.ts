import type { JSONSchema7 } from "json-schema"
import type { z } from "zod"

// ─── Messages ───────────────────────────────────────────────────────────────

/** Conversation role per the OpenAI / Anthropic chat conventions. */
export type Role = "system" | "user" | "assistant" | "tool"

/**
 * A single conversation turn. Immutable — the engine appends new messages
 * via the ContextManager rather than mutating existing ones.
 *
 * The `toolCalls` field is set on assistant messages that requested tools.
 * The `toolCallId` field is set on tool messages that respond to a specific call.
 */
export interface Message {
  /** ULID assigned by the engine on append. */
  readonly id: string
  readonly role: Role
  readonly content: string
  /** Present on assistant messages that proposed tool invocations. */
  readonly toolCalls?: readonly ToolCall[]
  /** Present on tool-role messages, matching the assistant's tool_call id. */
  readonly toolCallId?: string
  /** Unix millis at append time. */
  readonly timestamp: number
  /**
   * Provider-specific metadata. Adapters use this to round-trip data the
   * provider requires us to echo back (e.g. MiMo's `reasoning_content`,
   * Anthropic's `thinking` blocks). Generic shape:
   *
   *   metadata.reasoningContent?: string  // free-form reasoning text
   */
  readonly metadata?: Readonly<Record<string, unknown>>
}

// ─── Tool calls ─────────────────────────────────────────────────────────────

/**
 * A model's request to invoke a tool. `args` is raw — validate it against
 * the tool's Zod schema before passing to {@link Tool.execute}.
 */
export interface ToolCall {
  /** Identifier from the model (or generated when missing). */
  readonly id: string
  /** Tool name as declared in {@link Tool.name}. */
  readonly name: string
  /** Unvalidated arguments. May be an object or a JSON string. */
  readonly args: unknown
}

/**
 * The execution environment handed to a tool. The {@link signal} aborts when
 * the engine aborts or its caller cancels; tools must honor it for cancellable
 * operations. {@link onProgress} is optional — call to surface intermediate
 * status messages that flow as `tool.progress` events.
 */
export interface ToolContext {
  readonly cwd: string
  readonly signal: AbortSignal
  readonly env?: Readonly<Record<string, string>>
  readonly onProgress?: (message: string) => void
}

/**
 * Permission posture declared by a tool. The engine consults the configured
 * {@link PermissionGate} for `ask`; `auto` and `deny` are honored directly.
 */
export type ToolPermission = "auto" | "ask" | "deny"

/** Description of a tool sufficient for permission UIs. */
export interface ToolMeta {
  readonly name: string
  readonly description: string
  readonly permission: ToolPermission
}

/**
 * A capability the engine can invoke. Define one of these per side-effect
 * you want available to the model.
 *
 * @example Author a tool
 * ```ts
 * import { z } from "zod"
 * import type { Tool, ToolContext } from "@omni/core"
 *
 * const shout: Tool<{ text: string }, { result: string }> = {
 *   name: "shout",
 *   description: "Returns the input in upper case.",
 *   permission: "auto",
 *   schema: z.object({ text: z.string() }),
 *   async execute(args, ctx: ToolContext) {
 *     ctx.onProgress?.("shouting...")
 *     return { result: args.text.toUpperCase() }
 *   },
 * }
 * ```
 */
export interface Tool<TArgs = unknown, TResult = unknown> extends ToolMeta {
  /** Zod schema describing valid arguments. Source of truth for both validation and the model-facing JSON Schema. */
  readonly schema: z.ZodType<TArgs>
  /** Implementation. Should honor `ctx.signal` and throw on failure. */
  execute(args: TArgs, ctx: ToolContext): Promise<TResult>
}

/**
 * Tool description in the shape adapters pass to model providers.
 * `parameters` is JSON Schema (draft-07) generated from the Zod schema.
 */
export interface ToolSchema {
  readonly name: string
  readonly description: string
  /** JSON Schema (draft-07) describing the arguments. */
  readonly parameters: JSONSchema7
}

// ─── Model adapter ──────────────────────────────────────────────────────────

/** Why a model stopped generating. */
export type FinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter"
  | "error"
  | "unknown"

/** Token counts for a single model call. */
export interface TokenUsage {
  readonly promptTokens: number
  readonly completionTokens: number
  readonly totalTokens: number
}

/** Per-call usage with optional cost in USD (when the adapter can compute it). */
export interface UsageDelta extends TokenUsage {
  readonly costUsd?: number
}

/** Session-cumulative usage across model calls. */
export interface CumulativeUsage extends TokenUsage {
  /** Number of model calls aggregated. */
  readonly callCount: number
  readonly costUsd?: number
}

/**
 * Self-described capabilities of a model. Used by adapters to inform the
 * engine (e.g. context window), and by `improve/probe` to verify them.
 */
export interface ModelCapabilities {
  readonly contextWindow: number
  readonly maxOutputTokens?: number
  readonly supportsToolCalls: boolean
  readonly supportsStreaming: boolean
  readonly supportsParallelToolCalls?: boolean
  /** True if the model exposes chain-of-thought as a separate channel (Claude thinking, OpenAI o-series). */
  readonly supportsThinking?: boolean
  readonly costPer1kInput?: number
  readonly costPer1kOutput?: number
}

/** Parameters passed by the engine to {@link ModelAdapter.complete}. */
export interface CompleteParams {
  readonly messages: readonly Message[]
  readonly tools: readonly ToolSchema[]
  readonly temperature?: number
  readonly maxTokens?: number
  /** Adapters MUST honor this signal — abort in-flight fetches/streams when it triggers. */
  readonly signal: AbortSignal
}

/**
 * Events streamed from the model. Adapters translate provider-specific
 * payloads into this normalized shape; the engine consumes only this.
 *
 *  - `delta` — token chunk of assistant text
 *  - `thinking_delta` — token chunk of reasoning (when the provider exposes it)
 *  - `tool_call_start` — model began composing a tool call (id known)
 *  - `tool_call_args_delta` — streaming args for a tool call already started
 *  - `tool_call` — a completed tool call (must be emitted exactly once per call)
 *  - `done` — terminal event with finish reason and usage
 *  - `error` — terminal event with a (raw) error; the engine classifies it
 */
export type ModelEvent =
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "thinking_delta"; readonly text: string }
  | { readonly type: "tool_call_start"; readonly call: ToolCall }
  | { readonly type: "tool_call_args_delta"; readonly callId: string; readonly argsDelta: string }
  | { readonly type: "tool_call"; readonly call: ToolCall }
  | { readonly type: "done"; readonly finishReason: FinishReason; readonly usage?: UsageDelta }
  | { readonly type: "error"; readonly error: Error }

/**
 * The single interface every model provider must implement to plug into
 * the engine. Implementations live in `@omni/adapters`.
 *
 * @example Author an adapter
 * ```ts
 * import type { ModelAdapter, CompleteParams, ModelEvent } from "@omni/core"
 *
 * export class MyAdapter implements ModelAdapter {
 *   readonly id = "my-model"
 *   readonly name = "my-model"
 *   readonly capabilities = {
 *     contextWindow: 32_768,
 *     supportsToolCalls: true,
 *     supportsStreaming: true,
 *   }
 *   async *complete(params: CompleteParams): AsyncIterable<ModelEvent> {
 *     // call provider, translate its events into ModelEvent
 *     yield { type: "delta", text: "..." }
 *     yield { type: "done", finishReason: "stop" }
 *   }
 * }
 * ```
 */
export interface ModelAdapter {
  /** Stable identifier (used in events and capability profiles). */
  readonly id: string
  /** Human-readable model name. */
  readonly name: string
  readonly capabilities: ModelCapabilities
  complete(params: CompleteParams): AsyncIterable<ModelEvent>
  /**
   * The underlying provider model object (an AI SDK `LanguageModel`), when the
   * adapter wraps one. Enables structured-output features (`generateObject`) in
   * the planner/critic. Returns `undefined`/absent for adapters without one
   * (e.g. the mock adapter), which keeps them on the text-parsing path.
   *
   * Typed as `unknown` so `@omni/core` stays decoupled from the `ai` package;
   * consumers (`@omni/improve`) cast to the AI SDK model type.
   */
  languageModel?(): unknown
}

// ─── Session ────────────────────────────────────────────────────────────────

/** Serializable session state for persistence and resumption. */
export interface SessionSnapshot {
  readonly sessionId: string
  readonly messages: readonly Message[]
  readonly usage: CumulativeUsage
  readonly createdAt: number
  readonly updatedAt: number
}
