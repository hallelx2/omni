import { describe, expect, test } from "bun:test"
import type { Config } from "@omni/core"
import { VectorMemory } from "@omni/improve"
import type { VectorMemoryRepo } from "@omni/storage"
import {
  resolveEmbeddingModel,
  buildMemory,
  makeRememberTool,
  recallBlock,
  type MemoryWriter,
  type MemoryReader,
} from "../src/memory-runtime.ts"

const fakeRepo = {} as VectorMemoryRepo
const withKey: Config = { providers: { openai: { apiKey: "sk-test" } } }

describe("resolveEmbeddingModel", () => {
  test("throws on a ref without a provider", () => {
    expect(() => resolveEmbeddingModel("no-colon", {})).toThrow(/provider:model/)
  })
  test("throws on an unsupported provider", () => {
    expect(() => resolveEmbeddingModel("bogus:model", {})).toThrow(/unsupported embedding provider/)
  })
  test("builds an openai model", () => {
    expect(resolveEmbeddingModel("openai:text-embedding-3-small", withKey)).toBeDefined()
  })
  test("builds an ollama (openai-compatible) model", () => {
    expect(resolveEmbeddingModel("ollama:nomic-embed-text", {})).toBeDefined()
  })
})

describe("buildMemory", () => {
  test("null when memory is absent or disabled", () => {
    expect(buildMemory({}, fakeRepo)).toBeNull()
    expect(buildMemory({ memory: { enabled: false } }, fakeRepo)).toBeNull()
  })
  test("null + warning when enabled without an embedding model", () => {
    let warned = ""
    expect(buildMemory({ memory: { enabled: true } }, fakeRepo, (m) => (warned = m))).toBeNull()
    expect(warned).toMatch(/embeddingModel/)
  })
  test("null + warning on a bad embedding ref", () => {
    let warned = ""
    const cfg: Config = { memory: { enabled: true, embeddingModel: "bogus:x" } }
    expect(buildMemory(cfg, fakeRepo, (m) => (warned = m))).toBeNull()
    expect(warned).toMatch(/memory disabled/)
  })
  test("VectorMemory when enabled with a valid model", () => {
    const cfg: Config = {
      providers: { openai: { apiKey: "sk-test" } },
      memory: { enabled: true, embeddingModel: "openai:text-embedding-3-small" },
    }
    expect(buildMemory(cfg, fakeRepo)).toBeInstanceOf(VectorMemory)
  })
})

describe("makeRememberTool", () => {
  test("stores via the writer and echoes back", async () => {
    const seen: Array<{ kind: string; text: string }> = []
    const writer: MemoryWriter = {
      async add(o) {
        seen.push({ kind: o.kind, text: o.text })
        return {}
      },
    }
    const tool = makeRememberTool(writer)
    expect(tool.name).toBe("remember")
    const res = await tool.execute({ text: "prefers strict mode", kind: "preference" }, {} as never)
    expect(res.stored).toBe(true)
    expect(res.kind).toBe("preference")
    expect(seen[0]).toEqual({ kind: "preference", text: "prefers strict mode" })
  })
  test("defaults kind to 'fact'", async () => {
    let kind = ""
    const writer: MemoryWriter = {
      async add(o) {
        kind = o.kind
        return {}
      },
    }
    await makeRememberTool(writer).execute({ text: "x" }, {} as never)
    expect(kind).toBe("fact")
  })
})

describe("recallBlock", () => {
  const reader = (hits: { text: string; kind: string; score: number }[]): MemoryReader => ({
    async recall() {
      return hits.map((h) => ({ entry: { text: h.text, kind: h.kind }, score: h.score }))
    },
  })

  test("renders hits as a system block", async () => {
    const block = await recallBlock(reader([{ text: "prefers TS", kind: "preference", score: 0.9 }]), "ts?")
    expect(block).toContain("prefers TS")
    expect(block).toContain("(preference)")
    expect(block).toMatch(/recalled from earlier sessions/i)
  })
  test("null on no hits", async () => {
    expect(await recallBlock(reader([]), "q")).toBeNull()
  })
  test("null on empty query", async () => {
    expect(await recallBlock(reader([{ text: "x", kind: "fact", score: 1 }]), "   ")).toBeNull()
  })
  test("null when recall throws (best-effort)", async () => {
    const throwing: MemoryReader = {
      async recall() {
        throw new Error("embedding endpoint down")
      },
    }
    expect(await recallBlock(throwing, "q")).toBeNull()
  })
})
