import type { ModelProfile } from "./probe.ts"
import { adapt, type AdaptedStrategy } from "./adapt.ts"
import { fitness, tournamentSelect, type PromptVariant, type VariantPool } from "./evolve.ts"

/**
 * Tunables for variant selection. Defaults mirror `config.improve.evolve` so a
 * caller can pass the config block through verbatim.
 */
export interface EvolveSelectOptions {
  /** A variant must have ≥ minTrials before its fitness is trusted for exploitation. Default 3. */
  readonly minTrials?: number
  /** Epsilon: probability of exploring a challenger instead of the best variant. Default 0.1. */
  readonly explorationRate?: number
  /** Tournament size for exploration picks. Default 3. */
  readonly tournamentK?: number
  /** Injectable RNG for determinism in tests. Default Math.random. */
  readonly rng?: () => number
}

/** Why this session's prompt was chosen — surfaced by /evolve and traced. */
export type EvolveMode = "exploit" | "explore" | "fallback"

export interface VariantSelection {
  /** The strategy to drive the engine. `systemPrompt` may come from a variant. */
  readonly strategy: AdaptedStrategy
  /** The variant whose text was used, or null when falling back to the static tree. */
  readonly variant: PromptVariant | null
  readonly mode: EvolveMode
}

const DEFAULT_MIN_TRIALS = 3
const DEFAULT_EXPLORATION_RATE = 0.1
const DEFAULT_TOURNAMENT_K = 3

/**
 * The first variant seeded into a model's pool. An environment-free block of
 * operating principles layered ON TOP of the engine's environment-aware base
 * prompt (via `systemPromptPrefix`) — never a replacement for it. Written as
 * discrete rule lines so {@link mutatePrompt}'s add/drop/swap operations have
 * clean units to evolve. The header line is preserved by `dropRule` (it only
 * removes lines after the first).
 */
export const EVOLUTION_SEED = `## Operating principles (these evolve across sessions)
Work the task through to completion; confirm with tools before claiming done.
Prefer dedicated tools (glob, grep, read_file) over shelling out to discover or read files.
When a tool fails, change your approach instead of retrying the same call.
Keep going until every verifier is green, or report a concrete blocker and the exact next step.`

/**
 * Choose the system prompt for a session via epsilon-greedy selection over the
 * per-model variant pool, layered on the static {@link adapt} strategy.
 *
 * The static strategy is always the substrate — ReAct fallback, iteration
 * budget, planner/critic flags and output reserve are preserved; only the
 * `systemPrompt` may be substituted by an evolved variant.
 *
 *   1. base = adapt(profile)
 *   2. with probability `explorationRate` (and a non-empty pool): EXPLORE — pick
 *      via tournament over the whole pool (includes under-trialed challengers).
 *   3. else, if any variant has ≥ minTrials: EXPLOIT — pick the highest-fitness
 *      confident variant.
 *   4. else: FALLBACK — keep the static prompt.
 *
 * Deterministic under a seeded `rng`. Never throws — returns a fallback
 * selection on any degenerate input.
 */
export function adaptFromPool(
  profile: ModelProfile,
  pool: VariantPool,
  opts: EvolveSelectOptions = {},
): VariantSelection {
  const base = adapt(profile)
  const minTrials = opts.minTrials ?? DEFAULT_MIN_TRIALS
  const explorationRate = opts.explorationRate ?? DEFAULT_EXPLORATION_RATE
  const k = opts.tournamentK ?? DEFAULT_TOURNAMENT_K
  const rng = opts.rng ?? Math.random

  const variants = pool.variants
  const withText = (variant: PromptVariant, mode: EvolveMode): VariantSelection => ({
    strategy: { ...base, systemPrompt: variant.text },
    variant,
    mode,
  })

  // Truly cold pool → keep the static strategy.
  if (variants.length === 0) {
    return { strategy: base, variant: null, mode: "fallback" }
  }

  // EXPLORE — epsilon draw over the whole pool (challengers included).
  if (rng() < explorationRate) {
    const picked = tournamentSelect(pool, k, rng)
    if (picked) return withText(picked, "explore")
  }

  // EXPLOIT — best confident variant (≥ minTrials).
  const confident = variants.filter((v) => v.trials >= minTrials)
  if (confident.length > 0) {
    let best = confident[0]!
    for (const v of confident) if (fitness(v) > fitness(best)) best = v
    return withText(best, "exploit")
  }

  // Variants exist but none is confident yet — run the best-so-far to gather
  // trials (this is how a variant earns confidence). Ties break toward the most
  // recent (pool is created_at-ascending, so a later index is newer).
  let best = variants[0]!
  for (const v of variants) if (fitness(v) >= fitness(best)) best = v
  return withText(best, "explore")
}
