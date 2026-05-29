import { describe, expect, test } from "bun:test"
import { variantFromRow, rowFromVariant, poolFromRows } from "../src/evolve-store.ts"
import { addVariant, emptyPool } from "../src/evolve.ts"
import type { StoredVariant } from "@omni/storage"

describe("evolve-store bridge", () => {
  test("rowFromVariant → variantFromRow round-trips", () => {
    const { variant } = addVariant(emptyPool(), "rules", "parent-id")
    const withTrials = { ...variant, trials: 3, successScore: 2.1 }
    const row = rowFromVariant("model-x", withTrials)
    expect(row.model_id).toBe("model-x")
    expect(row.success_score).toBe(2.1)
    const back = variantFromRow(row)
    expect(back.id).toBe(withTrials.id)
    expect(back.text).toBe("rules")
    expect(back.parent).toBe("parent-id")
    expect(back.trials).toBe(3)
    expect(back.successScore).toBe(2.1)
    expect(back.createdAt).toBe(withTrials.createdAt)
  })

  test("poolFromRows([]) is an empty pool", () => {
    expect(poolFromRows([])).toEqual(emptyPool())
  })

  test("poolFromRows maps every row", () => {
    const rows: StoredVariant[] = [
      { id: "a", model_id: "m", text: "one", trials: 1, success_score: 0.5, created_at: 1 },
      { id: "b", model_id: "m", text: "two", parent: "a", trials: 0, success_score: 0, created_at: 2 },
    ]
    const pool = poolFromRows(rows)
    expect(pool.variants.length).toBe(2)
    expect(pool.variants[1]!.parent).toBe("a")
    expect(pool.variants[0]!.successScore).toBe(0.5)
  })
})
