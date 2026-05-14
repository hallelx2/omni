import { ulid } from "ulid"
import type {
  CompleteParams,
  ModelAdapter,
  ModelCapabilities,
  ModelEvent,
  ToolCall,
  UsageDelta,
} from "@omni/core"

export type MockScript =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool"; readonly name: string; readonly args: unknown }
  | { readonly kind: "tools"; readonly calls: ReadonlyArray<{ readonly name: string; readonly args: unknown }> }
  | { readonly kind: "thinking"; readonly text: string }
  | {
      readonly kind: "error"
      readonly message: string
      /** Optional HTTP status used to drive classification (e.g. 429 → retryable rate-limit). */
      readonly status?: number
    }

export interface MockAdapterOptions {
  readonly script: readonly MockScript[]
  readonly id?: string
  readonly capabilities?: Partial<ModelCapabilities>
  /** Delay between streamed chunks (ms). */
  readonly deltaMs?: number
  /** Tokens to report on done. Defaults to a small heuristic count. */
  readonly usage?: UsageDelta
}

/**
 * Deterministic adapter for tests and development. Plays back a scripted
 * sequence of model responses; advances on each `complete` call.
 *
 * The script length must match the number of model turns the engine will make.
 * Use {@link MockAdapterOptions.usage} to verify usage accumulation.
 */
export class MockAdapter implements ModelAdapter {
  readonly id: string
  readonly name = "mock"
  readonly capabilities: ModelCapabilities
  private cursor = 0

  constructor(private readonly options: MockAdapterOptions) {
    this.id = options.id ?? "mock-1"
    this.capabilities = {
      contextWindow: 32_768,
      supportsToolCalls: true,
      supportsStreaming: true,
      supportsParallelToolCalls: true,
      ...options.capabilities,
    }
  }

  async *complete(params: CompleteParams): AsyncIterable<ModelEvent> {
    const script = this.options.script
    if (script.length === 0) {
      yield { type: "done", finishReason: "stop", usage: this._defaultUsage(params) }
      return
    }

    const entry = script[this.cursor % script.length]
    this.cursor++

    if (!entry) {
      yield { type: "done", finishReason: "stop", usage: this._defaultUsage(params) }
      return
    }

    switch (entry.kind) {
      case "text": {
        for (const chunk of chunkString(entry.text, 8)) {
          if (params.signal.aborted) return
          if (this.options.deltaMs) await sleep(this.options.deltaMs)
          yield { type: "delta", text: chunk }
        }
        yield { type: "done", finishReason: "stop", usage: this._defaultUsage(params) }
        return
      }
      case "thinking": {
        for (const chunk of chunkString(entry.text, 8)) {
          if (params.signal.aborted) return
          if (this.options.deltaMs) await sleep(this.options.deltaMs)
          yield { type: "thinking_delta", text: chunk }
        }
        yield { type: "done", finishReason: "stop", usage: this._defaultUsage(params) }
        return
      }
      case "tool": {
        const call: ToolCall = { id: ulid(), name: entry.name, args: entry.args }
        yield { type: "tool_call_start", call }
        yield { type: "tool_call", call }
        yield { type: "done", finishReason: "tool_calls", usage: this._defaultUsage(params) }
        return
      }
      case "tools": {
        for (const c of entry.calls) {
          const call: ToolCall = { id: ulid(), name: c.name, args: c.args }
          yield { type: "tool_call_start", call }
          yield { type: "tool_call", call }
        }
        yield { type: "done", finishReason: "tool_calls", usage: this._defaultUsage(params) }
        return
      }
      case "error": {
        const err = Object.assign(new Error(entry.message), entry.status ? { status: entry.status } : {})
        yield { type: "error", error: err }
        return
      }
    }
  }

  /** Reset script cursor — useful in tests. */
  reset(): void {
    this.cursor = 0
  }

  private _defaultUsage(params: CompleteParams): UsageDelta {
    if (this.options.usage) return this.options.usage
    const promptTokens = params.messages.reduce(
      (n, m) => n + Math.ceil(m.content.length / 4),
      0,
    )
    return { promptTokens, completionTokens: 8, totalTokens: promptTokens + 8 }
  }
}

function* chunkString(s: string, size: number): Iterable<string> {
  for (let i = 0; i < s.length; i += size) yield s.slice(i, i + size)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
