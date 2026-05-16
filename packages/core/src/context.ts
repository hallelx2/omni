import type { Message, ModelAdapter } from "./types.ts"
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
  /** True when the strategy summarised one or more dropped messages. */
  readonly summarised?: boolean
}

/**
 * Pluggable strategy for fitting conversation history into a model's
 * context window. Implementations may drop oldest, summarise, or recall
 * by relevance.
 *
 * `fit` may be sync (cheap drops) OR async (LLM-driven summarisation).
 * The engine awaits whichever shape comes back.
 */
export interface ContextStrategy {
  fit(
    messages: readonly Message[],
    limits: ContextLimits,
  ): FitResult | Promise<FitResult>
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
 * Async strategy that, when the conversation exceeds the budget, asks a
 * model to summarise the oldest non-system messages into a single system
 * note. The recent N messages pass through unchanged.
 *
 * Use this when conversations get long enough that dropping turns loses
 * important context (a long debugging session where early discoveries
 * inform later steps).
 *
 * Caveats:
 *   - Uses a model call each time it fires. Pick a small/cheap summariser.
 *   - The summary is appended as a *new* system message; the original
 *     messages aren't mutated. (The engine sees the trimmed view returned
 *     by `fit`; full history is still in storage.)
 *   - On summariser failure (network, parse, etc.) falls back to the inner
 *     strategy without erroring.
 */
export class SummarizingStrategy implements ContextStrategy {
  /**
   * Most-recent cached summary so we don't re-run the summariser on every
   * call. Keyed implicitly by the IDs it covers (`coveredIds`); we reuse it
   * exactly when the next `toSummarise` window has the same IDs, and we
   * *extend* it when the new window starts with the same prefix.
   */
  private _cache: {
    readonly coveredIds: readonly string[]
    readonly text: string
  } | null = null

  constructor(
    private readonly options: {
      readonly summariser: ModelAdapter
      /** Inner strategy that produces the final FitResult. Default: TokenBudgetStrategy. */
      readonly inner?: ContextStrategy
      /**
       * How many recent non-system messages to ALWAYS pass through
       * untouched. Default 8.
       */
      readonly keepRecent?: number
      /** Token threshold above which summarisation runs. Default: 80% of budget. */
      readonly summariseAboveTokens?: number
      readonly tokenizer?: Tokenizer
    },
  ) {}

  async fit(messages: readonly Message[], limits: ContextLimits): Promise<FitResult> {
    const tokenizer = this.options.tokenizer ?? defaultTokenizer()
    const inner = this.options.inner ?? new TokenBudgetStrategy(tokenizer)
    const keepRecent = this.options.keepRecent ?? 8
    const threshold =
      this.options.summariseAboveTokens ?? Math.floor((limits.maxTokens ?? 32_000) * 0.8)

    const total = tokenizer.countMessages(messages)
    if (total <= threshold) {
      const r = await inner.fit(messages, limits)
      return r
    }

    const system = messages.filter((m) => m.role === "system")
    const rest = messages.filter((m) => m.role !== "system")

    if (rest.length <= keepRecent) {
      const r = await inner.fit(messages, limits)
      return r
    }

    const toSummarise = rest.slice(0, rest.length - keepRecent)
    const recent = rest.slice(rest.length - keepRecent)
    const toSummariseIds = toSummarise.map((m) => m.id)

    let summaryText: string
    try {
      summaryText = await this._getOrUpdateSummary(toSummarise, toSummariseIds)
    } catch {
      // Summariser failure: fall back to plain budget fit, no surprises.
      return await inner.fit(messages, limits)
    }

    const summaryMsg: Message = {
      id: `summary-${Date.now()}`,
      role: "system",
      content:
        "Summary of earlier turns (compacted to fit context):\n\n" + summaryText,
      timestamp: Date.now(),
    }
    const newView: readonly Message[] = [...system, summaryMsg, ...recent]
    const r = await inner.fit(newView, limits)
    return { ...r, summarised: true, dropped: r.dropped + toSummarise.length }
  }

  /** For tests/observability: how many times has a fresh summarise call been issued. */
  private _summariseCalls = 0
  /** @internal */ summariseCalls(): number {
    return this._summariseCalls
  }

  /** Drop any cached summary (e.g. after session reset). */
  resetCache(): void {
    this._cache = null
  }

  private async _getOrUpdateSummary(
    toSummarise: readonly Message[],
    ids: readonly string[],
  ): Promise<string> {
    const cache = this._cache
    if (cache && idsEqual(cache.coveredIds, ids)) {
      return cache.text
    }
    if (cache && isExtensionOf(cache.coveredIds, ids)) {
      const newTail = toSummarise.slice(cache.coveredIds.length)
      const updated = await this._extendSummary(cache.text, newTail)
      this._cache = { coveredIds: ids, text: updated }
      return updated
    }
    this._summariseCalls++
    const text = await this._summarise(toSummarise)
    this._cache = { coveredIds: ids, text }
    return text
  }

  private async _extendSummary(
    priorSummary: string,
    newMessages: readonly Message[],
  ): Promise<string> {
    this._summariseCalls++
    const transcript = newMessages
      .map((m) => `[${m.role}] ${m.content}${m.toolCalls ? ` (called ${m.toolCalls.length} tool(s))` : ""}`)
      .join("\n")
      .slice(0, 16_000)
    const promptMessages: readonly Message[] = [
      {
        id: "s-sys",
        role: "system",
        content:
          "You maintain a rolling summary of an agent conversation. You will receive the prior summary and the new turns since. Output an UPDATED summary in 4-8 bullets covering: the original task, key decisions, files/locations referenced, unresolved sub-tasks. Be terse. No preamble.",
        timestamp: Date.now(),
      },
      {
        id: "s-user",
        role: "user",
        content: `Prior summary:\n${priorSummary}\n\nNew turns:\n${transcript}\n\nProduce the updated summary now.`,
        timestamp: Date.now(),
      },
    ]
    return await this._runSummariser(promptMessages)
  }

  private async _summarise(messages: readonly Message[]): Promise<string> {
    const transcript = messages
      .map((m) => `[${m.role}] ${m.content}${m.toolCalls ? ` (called ${m.toolCalls.length} tool(s))` : ""}`)
      .join("\n")
      .slice(0, 16_000) // hard cap on input to summariser

    const promptMessages: readonly Message[] = [
      {
        id: "s-sys",
        role: "system",
        content:
          "You compress agent conversation history. Output 4-8 bullet points capturing: the original task, key decisions made, files/locations referenced, and any unresolved sub-tasks. Be terse. No preamble.",
        timestamp: Date.now(),
      },
      {
        id: "s-user",
        role: "user",
        content: `Summarise this transcript:\n\n${transcript}`,
        timestamp: Date.now(),
      },
    ]
    return await this._runSummariser(promptMessages)
  }

  private async _runSummariser(promptMessages: readonly Message[]): Promise<string> {
    const ac = new AbortController()
    let text = ""
    for await (const ev of this.options.summariser.complete({
      messages: promptMessages,
      tools: [],
      signal: ac.signal,
    })) {
      if (ev.type === "delta") text += ev.text
      else if (ev.type === "error") throw ev.error
      else if (ev.type === "done") break
    }
    return text.trim()
  }
}

function idsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** True when `cached` is a strict prefix of `next` (next extends cached). */
function isExtensionOf(cached: readonly string[], next: readonly string[]): boolean {
  if (next.length <= cached.length) return false
  for (let i = 0; i < cached.length; i++) if (cached[i] !== next[i]) return false
  return true
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

  /**
   * Trimmed view to send to the model. Awaits async strategies; sync
   * strategies (the default) resolve immediately.
   */
  async assemble(limits: ContextLimits = {}): Promise<FitResult> {
    const r = await this.strategy.fit(this._history, limits)
    return r
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
