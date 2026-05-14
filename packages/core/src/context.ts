import type { Message } from "./types.ts"
import type { Tokenizer } from "./tokenizer.ts"
import { defaultTokenizer } from "./tokenizer.ts"

/** Constraints the engine asks a context strategy to fit history into. */
export interface ContextLimits {
  readonly maxMessages?: number
  readonly maxTokens?: number
  /** Reserve this many tokens for the model's output. */
  readonly reserveTokensForOutput?: number
}

/** Outcome reported by a strategy: the kept messages and whether anything was dropped. */
export interface FitResult {
  readonly messages: readonly Message[]
  readonly dropped: number
  readonly tokensIn?: number
  readonly tokensOut?: number
}

/**
 * Pluggable strategy for fitting conversation history into a model's
 * context window. Implementations may drop oldest, summarize, or recall
 * by relevance.
 */
export interface ContextStrategy {
  fit(messages: readonly Message[], limits: ContextLimits): FitResult
}

/**
 * Keep all system messages, then the most recent N non-system messages so
 * total count ≤ `limits.maxMessages` (default 40). Ignores token count.
 */
export class SlidingWindowStrategy implements ContextStrategy {
  fit(messages: readonly Message[], limits: ContextLimits): FitResult {
    const max = limits.maxMessages ?? 40
    if (messages.length <= max) {
      return { messages, dropped: 0 }
    }
    const system = messages.filter((m) => m.role === "system")
    const rest = messages.filter((m) => m.role !== "system")
    const keep = Math.max(1, max - system.length)
    const kept = rest.slice(-keep)
    return {
      messages: [...system, ...kept],
      dropped: rest.length - kept.length,
    }
  }
}

/**
 * Fit messages into a token budget. Always keeps system messages and the
 * most recent user/assistant/tool messages until the budget is met. When
 * messages are dropped, the engine emits a `context.compacted` event.
 *
 * @example
 * ```ts
 * new TokenBudgetStrategy(new TiktokenTokenizer(), { reserveTokensForOutput: 4096 })
 * ```
 */
export class TokenBudgetStrategy implements ContextStrategy {
  constructor(
    private readonly tokenizer: Tokenizer = defaultTokenizer(),
    private readonly options: { readonly reserveTokensForOutput?: number } = {},
  ) {}

  fit(messages: readonly Message[], limits: ContextLimits): FitResult {
    const budget = limits.maxTokens
    if (!budget) return { messages, dropped: 0 }
    const reserve =
      limits.reserveTokensForOutput ?? this.options.reserveTokensForOutput ?? 1024
    const effective = Math.max(64, budget - reserve)

    const total = this.tokenizer.countMessages(messages)
    if (total <= effective) {
      return { messages, dropped: 0, tokensIn: total, tokensOut: total }
    }

    const system = messages.filter((m) => m.role === "system")
    const rest = messages.filter((m) => m.role !== "system")
    const systemTokens = this.tokenizer.countMessages(system)

    let keptTokens = systemTokens
    const kept: Message[] = []
    for (let i = rest.length - 1; i >= 0; i--) {
      const m = rest[i]!
      const mTokens = this.tokenizer.countMessages([m])
      if (keptTokens + mTokens > effective && kept.length > 0) break
      kept.unshift(m)
      keptTokens += mTokens
    }

    return {
      messages: [...system, ...kept],
      dropped: rest.length - kept.length,
      tokensIn: total,
      tokensOut: keptTokens,
    }
  }
}

/**
 * Append-only history store with a pluggable {@link ContextStrategy} to
 * produce the trimmed view passed to model calls.
 */
export class ContextManager {
  private readonly _history: Message[] = []

  constructor(private readonly strategy: ContextStrategy = new SlidingWindowStrategy()) {}

  /** Append a message to history. */
  append(message: Message): void {
    this._history.push(message)
  }

  /** Remove the most-recent message (used by the engine on retry). */
  pop(): Message | undefined {
    return this._history.pop()
  }

  /** Clear all messages. */
  clear(): void {
    this._history.length = 0
  }

  /** All messages in append order. */
  all(): readonly Message[] {
    return this._history
  }

  /** Trimmed view to send to the model, per the strategy. */
  assemble(limits: ContextLimits = {}): FitResult {
    return this.strategy.fit(this._history, limits)
  }
}

/**
 * Truncate a tool result so it doesn't drown a small model. If `text` exceeds
 * `maxBytes`, returns a head/tail summary with an elision marker.
 */
export function chunkToolResult(
  text: string,
  maxBytes: number,
): { readonly text: string; readonly truncated: boolean } {
  if (text.length <= maxBytes) return { text, truncated: false }
  const head = Math.floor(maxBytes * 0.7)
  const tail = Math.floor(maxBytes * 0.2)
  const dropped = text.length - head - tail
  return {
    text:
      text.slice(0, head) +
      `\n\n[... ${dropped} bytes elided to fit context budget ...]\n\n` +
      text.slice(-tail),
    truncated: true,
  }
}

/** Coarse character-based token estimate (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
