import { ulid } from "ulid"
import type {
  CompleteParams,
  CumulativeUsage,
  Message,
  ModelAdapter,
  ModelEvent,
  SessionSnapshot,
  Tool,
  ToolCall,
  ToolContext,
  ToolSchema,
} from "./types.ts"
import type { DoneReason, EngineEvent } from "./events.ts"
import { ContextManager } from "./context.ts"
import { AllowAllPermissions, type PermissionGate } from "./permissions.ts"
import { parseReActFallback, toToolSchema, validateToolCall } from "./validator.ts"
import { classifyError, type ClassifiedError } from "./util/errors.ts"
import { combineSignals, mergeStreams, sleep } from "./util/streams.ts"
import { AsyncQueue } from "./util/async-queue.ts"
import { accumulateUsage, zeroUsage } from "./util/usage.ts"
import { toolCallSetSignature } from "./util/signature.ts"

/**
 * Configuration passed once at construction. Fields marked optional have
 * reasonable defaults; everything else must be supplied.
 */
export interface EngineConfig {
  /** The model provider. One adapter per provider (MiMo, Anthropic, OpenAI...). */
  readonly model: ModelAdapter
  /** Tools available to the model this session. */
  readonly tools: readonly Tool[]
  /** Permission gate. Default: {@link AllowAllPermissions}. */
  readonly permissions?: PermissionGate
  /** Optional system prompt prepended to the conversation. */
  readonly systemPrompt?: string
  /** Hard ceiling on iterations per run. Default: 25. */
  readonly maxIterations?: number
  /** Working directory passed to tools. Defaults to `process.cwd()`. */
  readonly cwd?: string
  /** Environment for shell-like tools. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string>>
  /**
   * When true and the model emitted no native tool calls, parse Action:/Action Input:
   * text and synthesize a tool call. Useful for open models with weak function-calling.
   */
  readonly enableReActFallback?: boolean
  /** Custom context manager. Defaults to one with the {@link SlidingWindowStrategy}. */
  readonly contextManager?: ContextManager
  /**
   * Max retries on retryable errors per iteration. Retries do not consume
   * iteration budget. Default: 2.
   */
  readonly maxRetriesPerIteration?: number
  /**
   * Number of identical tool-call sets in the recent window that trip the
   * loop detector. Lower = more aggressive. Default: 3.
   */
  readonly loopDetectionThreshold?: number
  /**
   * Optional observer called for every emitted event before it reaches the
   * consumer. Use for logging, tracing, or persisting. If the tracer throws,
   * it is disabled for the rest of the run and an `engine.warning` is emitted.
   */
  readonly tracer?: (event: EngineEvent) => void
}

/** Options passed per-{@link Engine.run} call. */
export interface RunOptions {
  /** Caller-side cancellation. Combined with the engine's internal abort. */
  readonly signal?: AbortSignal
  /**
   * Optional system prompt prefix injected before THIS run only. Stays
   * with the conversation history (it's a real assistant-side anchor),
   * but is not part of the engine's persistent system prompt.
   *
   * Used by surfaces to temporarily layer in a skill's system prompt or
   * a planner's directive without rebuilding the engine.
   */
  readonly systemPromptPrefix?: string
  /**
   * Optional tool subset for THIS run. When set, the engine ignores any
   * tool call whose name isn't in the set (emits `tool.invalid` with the
   * reason "tool not enabled for this run").
   */
  readonly enabledTools?: ReadonlySet<string>
}

const DEFAULT_MAX_ITERATIONS = 25
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_LOOP_THRESHOLD = 3
const RECENT_SIGNATURE_WINDOW = 5

interface TurnResult {
  readonly assistantText: string
  readonly toolCalls: readonly ToolCall[]
  readonly reasoningText: string
  readonly error?: ClassifiedError
}

/**
 * The core agent loop.
 *
 * Yields {@link EngineEvent} as work happens — no buffering. Events are the
 * only public observation channel; the engine never logs or prints directly.
 *
 * Lifecycle:
 *   engine.start → (iteration → model events → tool events)* → engine.done
 */
export class Engine {
  private _sessionId: string = ulid()
  private readonly _abortController = new AbortController()
  private readonly _ctx: ContextManager
  private readonly _toolMap: ReadonlyMap<string, Tool>
  private readonly _permissions: PermissionGate
  private readonly _maxIterations: number
  private readonly _maxRetries: number
  private readonly _loopThreshold: number
  private readonly _cwd: string
  private readonly _env?: Readonly<Record<string, string>>
  private readonly _enableReActFallback: boolean
  private _cumulative: CumulativeUsage = zeroUsage()
  private readonly _recentSignatures: string[] = []
  private readonly _createdAt = Date.now()
  private _updatedAt = this._createdAt

  constructor(private readonly config: EngineConfig) {
    this._ctx = config.contextManager ?? new ContextManager()
    this._toolMap = new Map(config.tools.map((t) => [t.name, t]))
    this._permissions = config.permissions ?? new AllowAllPermissions()
    this._maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS
    this._maxRetries = config.maxRetriesPerIteration ?? DEFAULT_MAX_RETRIES
    this._loopThreshold = config.loopDetectionThreshold ?? DEFAULT_LOOP_THRESHOLD
    this._cwd = config.cwd ?? process.cwd()
    this._env = config.env
    this._enableReActFallback = config.enableReActFallback ?? false

    if (config.systemPrompt) {
      this._ctx.append(makeMessage("system", config.systemPrompt))
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Run a turn. Yields events as they happen.
   * The tracer (if configured) is called for every yielded event before it
   * reaches the consumer; tracer exceptions disable it for the rest of the run.
   */
  async *run(input: string, opts: RunOptions = {}): AsyncIterable<EngineEvent> {
    let tracer = this.config.tracer
    for await (const ev of this._runInternal(input, opts)) {
      if (tracer) {
        try {
          tracer(ev)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          tracer = undefined
          const warn: EngineEvent = {
            type: "engine.warning",
            category: "tracer",
            message: `tracer disabled after throw: ${msg}`,
            cause: e,
          }
          yield warn
        }
      }
      yield ev
    }
  }

  /** Cancel the current run (if any). */
  abort(): void {
    this._abortController.abort()
  }

  /** Read-only view of conversation history. */
  history(): readonly Message[] {
    return this._ctx.all()
  }

  /** Cumulative token usage and call count across this session. */
  usage(): CumulativeUsage {
    return this._cumulative
  }

  /** Stable session identifier (ULID generated at construction, preserved across restore). */
  sessionId(): string {
    return this._sessionId
  }

  /** Serialize current state for persistence. */
  snapshot(): SessionSnapshot {
    return {
      sessionId: this._sessionId,
      messages: this._ctx.all(),
      usage: this._cumulative,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
    }
  }

  /** Restore conversation history, usage, and session identity from a snapshot. */
  restore(snap: SessionSnapshot): void {
    this._sessionId = snap.sessionId
    this._ctx.clear()
    for (const m of snap.messages) this._ctx.append(m)
    this._cumulative = snap.usage
    this._updatedAt = snap.updatedAt
  }

  // ─── Private: main loop ───────────────────────────────────────────────────

  private async *_runInternal(input: string, opts: RunOptions): AsyncIterable<EngineEvent> {
    const startedAt = Date.now()
    const { signal, cleanup } = combineSignals(this._abortController.signal, opts.signal)
    const enabledTools = opts.enabledTools

    try {
      yield { type: "engine.start", sessionId: this._sessionId, input }
      if (opts.systemPromptPrefix) {
        this._ctx.append(makeMessage("system", opts.systemPromptPrefix))
      }
      this._ctx.append(makeMessage("user", input))
      this._touch()

      const effectiveTools = enabledTools
        ? this.config.tools.filter((t) => enabledTools.has(t.name))
        : this.config.tools
      const toolSchemas = effectiveTools.map(toToolSchema)
      let reason: DoneReason = "max_iterations"

      outer: for (let i = 1; i <= this._maxIterations; i++) {
        if (signal.aborted) {
          reason = "aborted"
          break
        }
        yield {
          type: "engine.iteration",
          iteration: i,
          maxIterations: this._maxIterations,
        }

        // Bounded retry loop within a single iteration.
        let turn: TurnResult
        let retries = 0
        retryLoop: while (true) {
          turn = yield* this._runModelTurn(toolSchemas, signal)
          if (!turn.error) break retryLoop
          if (turn.error.category === "aborted") {
            reason = "aborted"
            break outer
          }
          if (!turn.error.retryable || retries >= this._maxRetries) {
            yield { type: "engine.error", error: turn.error, fatal: true }
            reason = "fatal_error"
            break outer
          }
          retries++
          const delay = turn.error.retryAfterMs ?? 1_000
          yield {
            type: "engine.retrying",
            attempt: retries,
            delayMs: delay,
            reason: turn.error.category,
          }
          try {
            await sleep(delay, signal)
          } catch {
            reason = "aborted"
            break outer
          }
        }

        const metadata = turn.reasoningText
          ? { reasoningContent: turn.reasoningText }
          : undefined
        this._ctx.append(
          makeAssistantMessage(turn.assistantText, turn.toolCalls, metadata),
        )
        this._touch()

        let toolCalls = turn.toolCalls
        if (
          this._enableReActFallback &&
          toolCalls.length === 0 &&
          turn.assistantText.length > 0
        ) {
          const fallback = parseReActFallback(turn.assistantText)
          if (fallback) toolCalls = [fallback]
        }

        if (toolCalls.length === 0) {
          reason = "model_done"
          break
        }

        const sig = toolCallSetSignature(toolCalls)
        this._recentSignatures.push(sig)
        if (this._recentSignatures.length > RECENT_SIGNATURE_WINDOW) {
          this._recentSignatures.shift()
        }
        const occurrences = this._recentSignatures.filter((s) => s === sig).length
        if (occurrences >= this._loopThreshold) {
          yield {
            type: "engine.loop_detected",
            signature: sig,
            occurrences,
          }
          reason = "loop_detected"
          break
        }

        const executions = toolCalls.map((c) => this._executeToolCall(c, signal))
        for await (const ev of mergeStreams(executions)) {
          yield ev
        }
      }

      yield {
        type: "engine.done",
        reason,
        usage: this._cumulative,
        durationMs: Date.now() - startedAt,
      }
    } finally {
      cleanup()
    }
  }

  // ─── Private: turn machinery ──────────────────────────────────────────────

  private async *_runModelTurn(
    toolSchemas: readonly ToolSchema[],
    signal: AbortSignal,
  ): AsyncGenerator<EngineEvent, TurnResult, void> {
    yield { type: "model.start", modelId: this.config.model.id }

    const fit = this._ctx.assemble({
      maxTokens: this.config.model.capabilities.contextWindow,
      reserveTokensForOutput: this.config.model.capabilities.maxOutputTokens ?? 4_096,
    })
    if (fit.dropped > 0) {
      yield {
        type: "context.compacted",
        messagesBefore: this._ctx.all().length,
        messagesAfter: fit.messages.length,
      }
    }

    const params: CompleteParams = {
      messages: fit.messages,
      tools: toolSchemas,
      signal,
    }

    let assistantText = ""
    let reasoningText = ""
    const toolCalls: ToolCall[] = []
    let error: ClassifiedError | undefined

    try {
      let stream: AsyncIterable<ModelEvent>
      try {
        stream = this.config.model.complete(params)
      } catch (e) {
        error = classifyError(e)
        return { assistantText, toolCalls, reasoningText, error }
      }

      for await (const ev of stream) {
        if (signal.aborted) {
          error = classifyError(new DOMException("Aborted", "AbortError"))
          break
        }
        switch (ev.type) {
          case "delta":
            assistantText += ev.text
            yield { type: "model.delta", text: ev.text }
            break
          case "thinking_delta":
            reasoningText += ev.text
            yield { type: "model.thinking_delta", text: ev.text }
            break
          case "tool_call_start":
            yield { type: "model.tool_call_start", call: ev.call }
            break
          case "tool_call_args_delta":
            yield {
              type: "model.tool_call_args_delta",
              callId: ev.callId,
              argsDelta: ev.argsDelta,
            }
            break
          case "tool_call":
            toolCalls.push(ev.call)
            yield { type: "model.tool_call_done", call: ev.call }
            break
          case "done":
            if (ev.usage) {
              this._cumulative = accumulateUsage(this._cumulative, ev.usage)
              yield { type: "engine.usage", delta: ev.usage, total: this._cumulative }
            }
            yield { type: "model.done", finishReason: ev.finishReason, usage: ev.usage }
            break
          case "error":
            error = classifyError(ev.error)
            break
        }
      }
    } catch (e) {
      error = classifyError(e)
    }

    return { assistantText, toolCalls, reasoningText, error }
  }

  /**
   * Execute a single tool call. Full lifecycle as events:
   *   permission_requested → granted/denied → start → (progress*) → result|error
   * Progress events are interleaved with the final result via an AsyncQueue.
   */
  private async *_executeToolCall(
    call: ToolCall,
    parentSignal: AbortSignal,
  ): AsyncIterable<EngineEvent> {
    const tool = this._toolMap.get(call.name)
    if (!tool) {
      const reason = `unknown tool: ${call.name}`
      yield { type: "tool.invalid", call, reason }
      this._ctx.append(makeToolMessage(call.id, `Error: ${reason}`))
      return
    }

    const validation = validateToolCall(tool, call)
    if (!validation.ok) {
      yield { type: "tool.invalid", call, reason: validation.reason }
      this._ctx.append(makeToolMessage(call.id, `Error: ${validation.reason}`))
      return
    }

    yield {
      type: "tool.permission_requested",
      call,
      tool: { name: tool.name, description: tool.description, permission: tool.permission },
    }

    let decision: "allow" | "deny"
    try {
      decision = await this._permissions.check(tool, call)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      yield {
        type: "engine.warning",
        category: "permission_gate",
        message: `permission gate threw for ${tool.name}; treating as deny: ${msg}`,
        cause: e,
      }
      decision = "deny"
    }

    if (decision === "deny") {
      yield { type: "tool.permission_denied", call }
      this._ctx.append(
        makeToolMessage(call.id, `Error: permission denied for "${tool.name}".`),
      )
      return
    }
    yield { type: "tool.permission_granted", call }

    yield { type: "tool.start", call }
    const startedAt = Date.now()

    const { signal: toolSignal, cleanup } = combineSignals(parentSignal)
    const queue = new AsyncQueue<EngineEvent>()

    const toolCtx: ToolContext = {
      cwd: this._cwd,
      signal: toolSignal,
      env: this._env,
      onProgress: (message: string) => queue.push({ type: "tool.progress", call, message }),
    }

    // Run the tool concurrently; push the terminal event and close the queue.
    void (async () => {
      try {
        const result = await tool.execute(validation.value, toolCtx)
        const durationMs = Date.now() - startedAt
        queue.push({ type: "tool.result", call, result, durationMs })
        this._ctx.append(makeToolMessage(call.id, formatToolResult(result)))
      } catch (e) {
        const err = classifyError(e, { providerCode: "tool_failure" })
        const durationMs = Date.now() - startedAt
        queue.push({ type: "tool.error", call, error: err, durationMs })
        this._ctx.append(makeToolMessage(call.id, `Error: ${err.message}`))
      } finally {
        queue.close()
        cleanup()
      }
    })()

    for await (const ev of queue) yield ev
  }

  private _touch(): void {
    this._updatedAt = Date.now()
  }
}

// ─── Message constructors ─────────────────────────────────────────────────

function makeMessage(role: "system" | "user", content: string): Message {
  return { id: ulid(), role, content, timestamp: Date.now() }
}

function makeAssistantMessage(
  content: string,
  toolCalls: readonly ToolCall[],
  metadata?: Readonly<Record<string, unknown>>,
): Message {
  return {
    id: ulid(),
    role: "assistant",
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    timestamp: Date.now(),
    metadata,
  }
}

function makeToolMessage(toolCallId: string, content: string): Message {
  return { id: ulid(), role: "tool", content, toolCallId, timestamp: Date.now() }
}

const TOOL_RESULT_MAX_BYTES = 64_000

function formatToolResult(result: unknown): string {
  let text: string
  if (typeof result === "string") text = result
  else if (result === undefined || result === null) text = ""
  else {
    try {
      text = JSON.stringify(result, null, 2)
    } catch {
      text = String(result)
    }
  }
  if (text.length <= TOOL_RESULT_MAX_BYTES) return text
  const head = Math.floor(TOOL_RESULT_MAX_BYTES * 0.7)
  const tail = Math.floor(TOOL_RESULT_MAX_BYTES * 0.2)
  const dropped = text.length - head - tail
  return (
    text.slice(0, head) +
    `\n\n[... ${dropped} bytes elided to fit context budget ...]\n\n` +
    text.slice(-tail)
  )
}
