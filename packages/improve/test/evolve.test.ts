import { describe, expect, test } from "bun:test"
import {
  emptyPool,
  addVariant,
  recordTrial,
  fitness,
  tournamentSelect,
  mutatePrompt,
} from "../src/evolve.ts"

describe("VariantPool", () => {
  test("addVariant grows the pool immutably", () => {
    const p1 = emptyPool()
    const { pool: p2, variant: v1 } = addVariant(p1, "be terse")
    expect(p1.variants.length).toBe(0)
    expect(p2.variants.length).toBe(1)
    expect(v1.text).toBe("be terse")
    expect(v1.trials).toBe(0)
  })

  test("addVariant records parent for lineage", () => {
    const { pool: p1, variant: v1 } = addVariant(emptyPool(), "alpha")
    const { variant: v2 } = addVariant(p1, "beta", v1.id)
    expect(v2.parent).toBe(v1.id)
  })

  test("recordTrial updates stats", () => {
    const { pool: p1, variant: v } = addVariant(emptyPool(), "x")
    const p2 = recordTrial(p1, v.id, 0.8)
    const p3 = recordTrial(p2, v.id, 0.6)
    const updated = p3.variants[0]!
    expect(updated.trials).toBe(2)
    expect(updated.successScore).toBeCloseTo(1.4, 4)
    expect(fitness(updated)).toBeCloseTo(0.7, 4)
  })

  test("fitness is 0 for untrialed variants", () => {
    const { variant } = addVariant(emptyPool(), "x")
    expect(fitness(variant)).toBe(0)
  })
})

describe("tournamentSelect", () => {
  test("returns the best of k random picks", () => {
    let p = emptyPool()
    const { pool: p1, variant: a } = addVariant(p, "a")
    p = p1
    const { pool: p2, variant: b } = addVariant(p, "b")
    p = p2
    p = recordTrial(p, a.id, 0.9)
    p = recordTrial(p, b.id, 0.1)

    // Deterministic RNG: always pick index 0 first, index 1 second
    const seq = [0, 0.99, 0, 0.99]
    let i = 0
    const rng = () => seq[i++ % seq.length]!
    const winner = tournamentSelect(p, 2, rng)
    // Always picks both, returns whichever has higher fitness.
    expect(winner?.id).toBe(a.id)
  })

  test("returns null on empty pool", () => {
    expect(tournamentSelect(emptyPool())).toBeNull()
  })

  test("returns the sole variant when pool has one", () => {
    const { pool, variant } = addVariant(emptyPool(), "only")
    expect(tournamentSelect(pool)?.id).toBe(variant.id)
  })
})

describe("mutatePrompt", () => {
  test("produces a distinct string for at least one op", () => {
    const base = "You are terse. Be careful."
    // Try multiple seeds; at least one should diverge.
    const seeds = [0.0, 0.25, 0.5, 0.75]
    const outputs = seeds.map((s) => mutatePrompt(base, () => s))
    expect(outputs.some((o) => o !== base)).toBe(true)
  })

  test("is deterministic given the same rng", () => {
    const a = mutatePrompt("hello world", () => 0.0)
    const b = mutatePrompt("hello world", () => 0.0)
    expect(a).toBe(b)
  })
})
