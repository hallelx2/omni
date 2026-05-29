import { describe, expect, test } from "bun:test"
import { adaptFromPool } from "../src/adapt-pool.ts"
import { adapt } from "../src/adapt.ts"
import { emptyPool, addVariant, recordTrial, type VariantPool } from "../src/evolve.ts"
import type { ModelProfile } from "../src/probe.ts"

const PROFILE: ModelProfile = {
  modelId: "m",
  probedAt: 0,
  nativeToolCalls: true,
  followsInstructions: true,
  verboseByDefault: false,
  supportsStructuredOutput: true,
  averageLatencyMs: 100,
  errorRate: 0,
  notes: [],
}

/** Deterministic RNG over a fixed sequence (wraps). */
function seqRng(seq: number[]): () => number {
  let i = 0
  return () => seq[i++ % seq.length]!
}

/** A pool with one confident variant (trials=5, fitness=0.9). */
function confidentPool(): { pool: VariantPool; id: string } {
  const { pool: p1, variant } = addVariant(emptyPool(), "## evolved rules\nbe excellent")
  let p = p1
  for (let i = 0; i < 5; i++) p = recordTrial(p, variant.id, 0.9)
  return { pool: p, id: variant.id }
}

describe("adaptFromPool", () => {
  test("empty pool → fallback to the static strategy", () => {
    const sel = adaptFromPool(PROFILE, emptyPool())
    expect(sel.mode).toBe("fallback")
    expect(sel.variant).toBeNull()
    expect(sel.strategy.systemPrompt).toBe(adapt(PROFILE).systemPrompt)
  })

  test("confident variant is exploited when not exploring", () => {
    const { pool, id } = confidentPool()
    // rng above explorationRate → no explore; then exploit the best confident variant.
    const sel = adaptFromPool(PROFILE, pool, { rng: () => 0.99 })
    expect(sel.mode).toBe("exploit")
    expect(sel.variant?.id).toBe(id)
    expect(sel.strategy.systemPrompt).toContain("be excellent")
  })

  test("non-confident pool still runs the best-so-far (to gather trials)", () => {
    const { pool, variant } = addVariant(emptyPool(), "## new\nchallenger")
    const oneTrial = recordTrial(pool, variant.id, 0.5) // trials=1 < default minTrials(3)
    const sel = adaptFromPool(PROFILE, oneTrial, { rng: () => 0.99 })
    expect(sel.mode).toBe("explore")
    expect(sel.variant?.id).toBe(variant.id)
  })

  test("epsilon draw triggers exploration deterministically", () => {
    const { pool } = confidentPool()
    const a = adaptFromPool(PROFILE, pool, { rng: seqRng([0.01, 0, 0, 0]) })
    const b = adaptFromPool(PROFILE, pool, { rng: seqRng([0.01, 0, 0, 0]) })
    expect(a.mode).toBe("explore")
    expect(a.variant?.id).toBe(b.variant?.id) // same seed → same pick
  })

  test("only the systemPrompt is overridden; the rest of the strategy is preserved", () => {
    const { pool } = confidentPool()
    const base = adapt(PROFILE)
    const sel = adaptFromPool(PROFILE, pool, { rng: () => 0.99 })
    expect(sel.strategy.enableReActFallback).toBe(base.enableReActFallback)
    expect(sel.strategy.maxIterations).toBe(base.maxIterations)
    expect(sel.strategy.usePlanner).toBe(base.usePlanner)
    expect(sel.strategy.reserveOutputTokens).toBe(base.reserveOutputTokens)
    expect(sel.strategy.systemPrompt).not.toBe(base.systemPrompt)
  })
})
