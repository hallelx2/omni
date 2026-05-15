import { describe, expect, test } from "bun:test"
import { Storage, VectorMemoryRepo } from "@omni/storage"
import { VectorMemory } from "../src/vector-memory.ts"

/**
 * Mock the AI SDK's embedding model with a deterministic stand-in:
 * the embedding is a 4-dim vector whose values are derived from character
 * codes of the text. Not a real embedding — but reproducible across calls,
 * which is what tests need.
 */
function fakeEmbeddingModel() {
  // 16-dim hash-bucket embedding, length-normalised so unrelated strings
  // produce nearly-orthogonal vectors.
  return {
    specificationVersion: "v2",
    provider: "fake",
    modelId: "fake-embed",
    maxEmbeddingsPerCall: 100,
    supportsParallelCalls: false,
    async doEmbed(opts: { values: string[] }) {
      const DIM = 16
      const embeddings = opts.values.map((v) => {
        const e = new Array(DIM).fill(0) as number[]
        for (let i = 0; i < v.length - 1; i++) {
          // bigram hash → bucket
          const h = (v.charCodeAt(i) * 31 + v.charCodeAt(i + 1)) % DIM
          e[h]! += 1
        }
        let sum = 0
        for (const x of e) sum += x * x
        const n = Math.sqrt(sum) || 1
        return e.map((x) => x / n)
      })
      return { embeddings, usage: { tokens: 0 } }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

function mkVM() {
  const store = new Storage(":memory:")
  const repo = new VectorMemoryRepo(store)
  const vm = new VectorMemory({ repo, model: fakeEmbeddingModel() })
  return { vm, store }
}

describe("VectorMemory", () => {
  test("add + count", async () => {
    const { vm, store } = mkVM()
    await vm.add({ kind: "fact", text: "first" })
    await vm.add({ kind: "fact", text: "second" })
    expect(vm.count()).toBe(2)
    store.close()
  })

  test("addMany batches embedding calls", async () => {
    const { vm, store } = mkVM()
    const out = await vm.addMany([
      { kind: "fact", text: "a" },
      { kind: "fact", text: "b" },
      { kind: "fact", text: "c" },
    ])
    expect(out.length).toBe(3)
    expect(vm.count()).toBe(3)
    store.close()
  })

  test("recall by similarity", async () => {
    const { vm, store } = mkVM()
    // Strings with shared bigrams embed to similar vectors
    await vm.add({ kind: "fact", text: "typescript typescript typescript" })
    await vm.add({ kind: "fact", text: "ferrari testarossa motorsport racing engine" })
    const hits = await vm.recall("typescript")
    expect(hits.length).toBeGreaterThan(0)
    // Top hit should be the typescript-related entry (bigram overlap wins)
    expect(hits[0]!.entry.text).toContain("typescript")
    store.close()
  })

  test("recall respects k limit", async () => {
    const { vm, store } = mkVM()
    for (let i = 0; i < 10; i++) {
      await vm.add({ kind: "fact", text: `entry ${i}` })
    }
    const hits = await vm.recall("entry", { k: 3 })
    expect(hits.length).toBe(3)
    store.close()
  })

  test("recall filters by kind", async () => {
    const { vm, store } = mkVM()
    await vm.add({ kind: "fact", text: "a fact" })
    await vm.add({ kind: "skill", text: "a skill" })
    const facts = await vm.recall("a", { kind: "fact" })
    expect(facts.every((h) => h.entry.kind === "fact")).toBe(true)
    store.close()
  })

  test("recall filters by tag", async () => {
    const { vm, store } = mkVM()
    await vm.add({ kind: "fact", text: "alpha", tags: ["x"] })
    await vm.add({ kind: "fact", text: "beta", tags: ["y"] })
    const x = await vm.recall("alpha", { tag: "x" })
    expect(x.every((h) => (h.entry.tags ?? []).includes("x"))).toBe(true)
  })

  test("recall with empty query returns []", async () => {
    const { vm, store } = mkVM()
    await vm.add({ kind: "fact", text: "x" })
    expect(await vm.recall("")).toEqual([])
    expect(await vm.recall("   ")).toEqual([])
    store.close()
  })

  test("minScore drops low-similarity hits", async () => {
    const { vm, store } = mkVM()
    await vm.add({ kind: "fact", text: "completely different content here" })
    const hits = await vm.recall("xyz123qwerty", { minScore: 0.99 })
    expect(hits.length).toBe(0)
    store.close()
  })

  test("remove + clear", async () => {
    const { vm, store } = mkVM()
    const e = await vm.add({ kind: "fact", text: "x" })
    expect(vm.remove(e.id)).toBe(true)
    expect(vm.remove(e.id)).toBe(false)
    await vm.add({ kind: "fact", text: "y" })
    vm.clear()
    expect(vm.count()).toBe(0)
    store.close()
  })
})
