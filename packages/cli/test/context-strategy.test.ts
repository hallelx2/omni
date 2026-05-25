import { describe, expect, test } from "bun:test"
import {
  SummarizingStrategy,
  SlidingWindowStrategy,
  TokenBudgetStrategy,
  type Config,
  type ModelAdapter,
} from "@omni/core"
import { buildContextStrategy } from "../src/bootstrap.ts"

const mockAdapter: ModelAdapter = {
  id: "mock",
  name: "mock",
  capabilities: { supportsToolCalls: false, supportsStreaming: true, contextWindow: 8192 },
  async *complete() {
    yield { type: "done" }
  },
} as unknown as ModelAdapter

const deps = (resolveModel: (ref?: string) => ModelAdapter = () => mockAdapter) => ({
  summariser: mockAdapter,
  resolveModel,
  reserveOutputTokens: 4096,
})

describe("buildContextStrategy", () => {
  test("defaults to TokenBudgetStrategy when no context config", () => {
    expect(buildContextStrategy({}, deps())).toBeInstanceOf(TokenBudgetStrategy)
  })

  test("explicit 'budget' selects TokenBudgetStrategy", () => {
    const cfg: Config = { context: { compaction: "budget" } }
    expect(buildContextStrategy(cfg, deps())).toBeInstanceOf(TokenBudgetStrategy)
  })

  test("'sliding' selects SlidingWindowStrategy", () => {
    const cfg: Config = { context: { compaction: "sliding" } }
    expect(buildContextStrategy(cfg, deps())).toBeInstanceOf(SlidingWindowStrategy)
  })

  test("'summarize' selects SummarizingStrategy", () => {
    const cfg: Config = { context: { compaction: "summarize" } }
    expect(buildContextStrategy(cfg, deps())).toBeInstanceOf(SummarizingStrategy)
  })

  test("'summarize' routes summarizerModel through resolveModel", () => {
    let asked: string | undefined
    const cfg: Config = { context: { compaction: "summarize", summarizerModel: "anthropic:claude-haiku" } }
    buildContextStrategy(
      cfg,
      deps((ref) => {
        asked = ref
        return mockAdapter
      }),
    )
    expect(asked).toBe("anthropic:claude-haiku")
  })

  test("'summarize' without summarizerModel does not call resolveModel", () => {
    let called = false
    const cfg: Config = { context: { compaction: "summarize" } }
    buildContextStrategy(
      cfg,
      deps(() => {
        called = true
        return mockAdapter
      }),
    )
    expect(called).toBe(false)
  })
})
