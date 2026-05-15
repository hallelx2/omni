import { describe, expect, test } from "bun:test"
import { Storage, VectorMemoryRepo } from "../src/index.ts"

function mkRepo() {
  const s = new Storage(":memory:")
  return { store: s, repo: new VectorMemoryRepo(s) }
}

function vec(...nums: number[]): Float32Array {
  return new Float32Array(nums)
}

describe("VectorMemoryRepo", () => {
  test("migration 4 creates vector_memory table", () => {
    const s = new Storage(":memory:")
    expect(s.schemaVersion()).toBeGreaterThanOrEqual(4)
    const row = s.db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='vector_memory'")
      .get() as { name: string } | null
    expect(row?.name).toBe("vector_memory")
    s.close()
  })

  test("insert + count + list", () => {
    const { store, repo } = mkRepo()
    repo.insert({
      id: "a",
      kind: "fact",
      text: "first",
      embedding: vec(1, 0, 0),
    })
    repo.insert({
      id: "b",
      kind: "fact",
      text: "second",
      embedding: vec(0, 1, 0),
    })
    expect(repo.count()).toBe(2)
    expect(repo.list().length).toBe(2)
    store.close()
  })

  test("list filters by kind", () => {
    const { store, repo } = mkRepo()
    repo.insert({ id: "a", kind: "fact", text: "x", embedding: vec(1, 0) })
    repo.insert({ id: "b", kind: "skill", text: "y", embedding: vec(0, 1) })
    expect(repo.list({ kind: "fact" }).length).toBe(1)
    expect(repo.list({ kind: "skill" }).length).toBe(1)
    store.close()
  })

  test("topK returns most-similar first", () => {
    const { store, repo } = mkRepo()
    repo.insert({ id: "x", kind: "fact", text: "x-axis", embedding: vec(1, 0, 0) })
    repo.insert({ id: "y", kind: "fact", text: "y-axis", embedding: vec(0, 1, 0) })
    repo.insert({ id: "near-x", kind: "fact", text: "near x", embedding: vec(0.9, 0.1, 0) })
    const hits = repo.topK(vec(1, 0, 0), 3)
    expect(hits[0]!.entry.id).toBe("x") // identical → score 1
    expect(hits[1]!.entry.id).toBe("near-x") // close
    expect(hits[2]!.entry.id).toBe("y") // orthogonal
  })

  test("topK respects k limit", () => {
    const { store, repo } = mkRepo()
    for (let i = 0; i < 10; i++) {
      repo.insert({ id: `e${i}`, kind: "fact", text: String(i), embedding: vec(i, 1) })
    }
    expect(repo.topK(vec(1, 1), 3).length).toBe(3)
    store.close()
  })

  test("topK filters by kind before scoring", () => {
    const { store, repo } = mkRepo()
    repo.insert({ id: "f", kind: "fact", text: "f", embedding: vec(1, 0) })
    repo.insert({ id: "s", kind: "skill", text: "s", embedding: vec(1, 0) })
    const hits = repo.topK(vec(1, 0), 5, { kind: "skill" })
    expect(hits.length).toBe(1)
    expect(hits[0]!.entry.kind).toBe("skill")
  })

  test("topK filters by tag", () => {
    const { store, repo } = mkRepo()
    repo.insert({ id: "a", kind: "fact", text: "a", tags: ["x"], embedding: vec(1, 0) })
    repo.insert({ id: "b", kind: "fact", text: "b", tags: ["y"], embedding: vec(1, 0) })
    const hits = repo.topK(vec(1, 0), 5, { tag: "x" })
    expect(hits.length).toBe(1)
    expect(hits[0]!.entry.tags).toEqual(["x"])
  })

  test("delete + clear", () => {
    const { store, repo } = mkRepo()
    repo.insert({ id: "a", kind: "fact", text: "x", embedding: vec(1) })
    repo.insert({ id: "b", kind: "fact", text: "y", embedding: vec(2) })
    expect(repo.delete("a")).toBe(true)
    expect(repo.delete("nope")).toBe(false)
    expect(repo.count()).toBe(1)
    repo.clear()
    expect(repo.count()).toBe(0)
    store.close()
  })

  test("embedding bytes round-trip exactly", () => {
    const { store, repo } = mkRepo()
    const original = new Float32Array([0.1, -0.5, 3.14159, -0.000001])
    repo.insert({ id: "a", kind: "fact", text: "x", embedding: original })
    const row = repo.list()[0]!
    expect(Array.from(row.embedding)).toEqual(Array.from(original))
    store.close()
  })

  test("zero-norm query returns empty", () => {
    const { store, repo } = mkRepo()
    repo.insert({ id: "a", kind: "fact", text: "x", embedding: vec(1, 0) })
    expect(repo.topK(vec(0, 0), 5)).toEqual([])
    store.close()
  })
})
