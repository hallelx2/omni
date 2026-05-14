import { ulid } from "ulid"

/**
 * A candidate system prompt in the evolutionary pool. Each variant carries
 * a running statistical estimate of its quality from observed traces.
 */
export interface PromptVariant {
  readonly id: string
  readonly text: string
  readonly parent?: string
  readonly trials: number
  readonly successScore: number // sum of trace scores
  readonly createdAt: number
}

export interface VariantPool {
  readonly variants: readonly PromptVariant[]
}

export function emptyPool(): VariantPool {
  return { variants: [] }
}

/**
 * Add a variant to the pool. If `parent` is provided, it's recorded for
 * lineage tracking. The pool is immutable — returns a new VariantPool.
 */
export function addVariant(
  pool: VariantPool,
  text: string,
  parent?: string,
): { pool: VariantPool; variant: PromptVariant } {
  const v: PromptVariant = {
    id: ulid(),
    text,
    parent,
    trials: 0,
    successScore: 0,
    createdAt: Date.now(),
  }
  return { pool: { variants: [...pool.variants, v] }, variant: v }
}

/**
 * Record a trial result. Returns a new pool with updated stats for the variant.
 */
export function recordTrial(pool: VariantPool, variantId: string, score: number): VariantPool {
  return {
    variants: pool.variants.map((v) =>
      v.id === variantId
        ? { ...v, trials: v.trials + 1, successScore: v.successScore + score }
        : v,
    ),
  }
}

/** Mean score for a variant — fitness. Variants with no trials get 0. */
export function fitness(v: PromptVariant): number {
  return v.trials === 0 ? 0 : v.successScore / v.trials
}

/**
 * Tournament selection: pick `k` variants at random, return the best by fitness.
 * Falls back to random when pool is empty.
 */
export function tournamentSelect(pool: VariantPool, k = 3, rng = Math.random): PromptVariant | null {
  if (pool.variants.length === 0) return null
  if (pool.variants.length === 1) return pool.variants[0]!
  const picks: PromptVariant[] = []
  for (let i = 0; i < k; i++) {
    const idx = Math.floor(rng() * pool.variants.length)
    picks.push(pool.variants[idx]!)
  }
  picks.sort((a, b) => fitness(b) - fitness(a))
  return picks[0]!
}

/**
 * Simple text-level mutation: pick one of several edit operations and apply.
 * Deterministic given the same `rng`.
 */
export function mutatePrompt(text: string, rng: () => number = Math.random): string {
  const ops = [
    addRule,
    dropRule,
    swapAdjective,
    appendConstraint,
  ]
  const op = ops[Math.floor(rng() * ops.length)]!
  return op(text, rng)
}

function addRule(text: string, rng: () => number): string {
  const candidates = [
    "Always verify changes by reading the file back.",
    "When uncertain, list the options before choosing.",
    "If a tool fails, try a different approach rather than retrying identically.",
    "Prefer small, focused tool calls over large ones.",
    "Confirm assumptions explicitly when the user's intent is ambiguous.",
  ]
  const pick = candidates[Math.floor(rng() * candidates.length)]!
  return text.includes(pick) ? text : `${text}\n${pick}`
}

function dropRule(text: string, rng: () => number): string {
  const lines = text.split("\n")
  if (lines.length <= 2) return text
  const idx = Math.floor(rng() * (lines.length - 1)) + 1
  return [...lines.slice(0, idx), ...lines.slice(idx + 1)].join("\n")
}

function swapAdjective(text: string, _rng: () => number): string {
  const map: Record<string, string> = {
    terse: "concise",
    concise: "terse",
    careful: "thoughtful",
    thoughtful: "careful",
    explicit: "clear",
    clear: "explicit",
  }
  for (const [a, b] of Object.entries(map)) {
    const re = new RegExp(`\\b${a}\\b`, "i")
    if (re.test(text)) return text.replace(re, b)
  }
  return text
}

function appendConstraint(text: string, _rng: () => number): string {
  if (text.includes("[mutated]")) return text
  return `${text.trimEnd()} [mutated]`
}
