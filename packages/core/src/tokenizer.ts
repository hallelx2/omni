import { getEncoding, type TiktokenEncoding } from "js-tiktoken"
import type { Message } from "./types.ts"

/**
 * Counts tokens for budget calculation. Each provider has a native tokenizer;
 * adapters supply one. When unknown, fall back to {@link CharEstimator}.
 */
export interface Tokenizer {
  /** Token count for an opaque string. */
  count(text: string): number
  /**
   * Token count for an array of messages including role/tool-call overhead.
   * The default implementation sums `count(content)` plus a fixed
   * per-message overhead.
   */
  countMessages(messages: readonly Message[]): number
}

/**
 * cl100k_base / o200k_base tokenizer via `js-tiktoken`. Use for OpenAI,
 * MiMo, and most OpenAI-compatible models. Loads the BPE on construction.
 */
export class TiktokenTokenizer implements Tokenizer {
  private readonly enc: ReturnType<typeof getEncoding>
  constructor(encoding: TiktokenEncoding = "cl100k_base") {
    this.enc = getEncoding(encoding)
  }
  count(text: string): number {
    if (!text) return 0
    return this.enc.encode(text).length
  }
  countMessages(messages: readonly Message[]): number {
    let total = 0
    for (const m of messages) {
      total += this.count(m.content) + 4 // role + separators
      if (m.toolCalls) {
        for (const c of m.toolCalls) {
          total += this.count(c.name) + this.count(JSON.stringify(c.args)) + 6
        }
      }
      if (m.toolCallId) total += 4
    }
    return total + 2 // priming
  }
}

/**
 * Coarse estimator: 4 characters per token. ~80% accurate; cheap and dep-free.
 * Useful as a fallback when no native tokenizer is wired.
 */
export class CharEstimator implements Tokenizer {
  constructor(private readonly charsPerToken = 4) {}
  count(text: string): number {
    if (!text) return 0
    return Math.ceil(text.length / this.charsPerToken)
  }
  countMessages(messages: readonly Message[]): number {
    let total = 0
    for (const m of messages) {
      total += this.count(m.content) + 4
      if (m.toolCalls) {
        for (const c of m.toolCalls) {
          total += this.count(c.name) + this.count(JSON.stringify(c.args)) + 6
        }
      }
    }
    return total + 2
  }
}

/** Default singleton — cheap, deterministic, no native binary needed. */
let _defaultTokenizer: Tokenizer | null = null
export function defaultTokenizer(): Tokenizer {
  if (!_defaultTokenizer) {
    try {
      _defaultTokenizer = new TiktokenTokenizer("cl100k_base")
    } catch {
      _defaultTokenizer = new CharEstimator()
    }
  }
  return _defaultTokenizer
}
