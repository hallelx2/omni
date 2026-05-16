import { describe, expect, test } from "bun:test"
import { ulid } from "ulid"
import {
  ContextManager,
  SlidingWindowStrategy,
  SummarizingStrategy,
  TokenBudgetStrategy,
  TiktokenTokenizer,
  CharEstimator,
  chunkToolResult,
  type Message,
  type ModelAdapter,
} from "../src/index.ts"

function mkMsg(role: Message["role"], content: string): Message {
  return { id: ulid(), role, content, timestamp: Date.now() }
}

describe("SlidingWindowStrategy", () => {
  test("keeps all messages when under limit", () => {
    const s = new SlidingWindowStrategy()
    const msgs = [mkMsg("user", "a"), mkMsg("assistant", "b")]
    const r = s.fit(msgs, { maxMessages: 10 })
    expect(r.dropped).toBe(0)
    expect(r.messages).toEqual(msgs)
  })

  test("drops oldest non-system, keeps system", () => {
    const s = new SlidingWindowStrategy()
    const msgs: Message[] = [
      mkMsg("system", "sys"),
      mkMsg("user", "1"),
      mkMsg("assistant", "2"),
      mkMsg("user", "3"),
      mkMsg("assistant", "4"),
      mkMsg("user", "5"),
    ]
    const r = s.fit(msgs, { maxMessages: 3 })
    expect(r.messages.map((m) => m.role)).toEqual(["system", "assistant", "user"])
    expect(r.messages[2]!.content).toBe("5")
    expect(r.dropped).toBe(3)
  })
})

describe("TokenBudgetStrategy", () => {
  test("keeps all when under budget", () => {
    const tok = new CharEstimator()
    const s = new TokenBudgetStrategy(tok)
    const msgs = [mkMsg("user", "hi"), mkMsg("assistant", "hello")]
    const r = s.fit(msgs, { maxTokens: 1000, reserveTokensForOutput: 256 })
    expect(r.dropped).toBe(0)
  })

  test("drops oldest non-system to fit budget", () => {
    const tok = new CharEstimator() // 1 token per 4 chars
    const s = new TokenBudgetStrategy(tok)
    const big = "x".repeat(400) // ~100 tokens
    const msgs: Message[] = [
      mkMsg("system", "sys"),
      mkMsg("user", big),
      mkMsg("assistant", big),
      mkMsg("user", "recent"),
    ]
    const r = s.fit(msgs, { maxTokens: 300, reserveTokensForOutput: 100 })
    // Budget effective = 200. system + recent should fit; older big messages dropped.
    expect(r.dropped).toBeGreaterThan(0)
    expect(r.messages.find((m) => m.role === "system")).toBeDefined()
    expect(r.messages[r.messages.length - 1]!.content).toBe("recent")
  })

  test("uses tiktoken counts", () => {
    const tok = new TiktokenTokenizer()
    expect(tok.count("hello world")).toBeGreaterThan(0)
    expect(tok.count("")).toBe(0)
    // tiktoken should count <= chars
    expect(tok.count("abc")).toBeLessThanOrEqual(3)
  })

  test("system messages are preserved even when total dwarfs budget", () => {
    const tok = new CharEstimator()
    const s = new TokenBudgetStrategy(tok)
    const msgs: Message[] = [
      mkMsg("system", "must keep this"),
      mkMsg("user", "x".repeat(10_000)),
      mkMsg("assistant", "x".repeat(10_000)),
      mkMsg("user", "newest"),
    ]
    const r = s.fit(msgs, { maxTokens: 200, reserveTokensForOutput: 50 })
    expect(r.messages.find((m) => m.role === "system")).toBeDefined()
  })
})

describe("chunkToolResult", () => {
  test("passes through small text", () => {
    const r = chunkToolResult("hello", 100)
    expect(r.truncated).toBe(false)
    expect(r.text).toBe("hello")
  })

  test("clips with head/tail markers when oversized", () => {
    const head = "START_"
    const tail = "_END"
    const middle = "x".repeat(1000)
    const r = chunkToolResult(head + middle + tail, 100)
    expect(r.truncated).toBe(true)
    expect(r.text.startsWith(head)).toBe(true)
    expect(r.text.endsWith(tail)).toBe(true)
    expect(r.text).toContain("elided")
  })
})

describe("ContextManager.assemble emits FitResult", () => {
  test("returns FitResult shape", async () => {
    const cm = new ContextManager(new SlidingWindowStrategy())
    cm.append(mkMsg("user", "hi"))
    const r = await cm.assemble({ maxMessages: 10 })
    expect(r.messages.length).toBe(1)
    expect(r.dropped).toBe(0)
  })
})

describe("SummarizingStrategy caching", () => {
  function mockSummariser(replyText: string): {
    adapter: ModelAdapter
    callCount: () => number
  } {
    let calls = 0
    const adapter: ModelAdapter = {
      id: "mock-summariser",
      capabilities: {
        supportsToolCalls: false,
        supportsStreaming: true,
        contextWindow: 8192,
      },
      async *complete() {
        calls++
        yield { type: "delta", text: replyText }
        yield { type: "done" }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    return { adapter, callCount: () => calls }
  }

  test("reuses cached summary when toSummarise window is unchanged", async () => {
    const { adapter, callCount } = mockSummariser("- task A\n- decision X")
    const s = new SummarizingStrategy({
      summariser: adapter,
      keepRecent: 2,
      summariseAboveTokens: 1, // force summarisation
      tokenizer: new CharEstimator(),
    })
    const msgs: Message[] = [
      mkMsg("system", "sys"),
      mkMsg("user", "first"),
      mkMsg("assistant", "first-reply"),
      mkMsg("user", "newest-1"),
      mkMsg("assistant", "newest-2"),
    ]
    const r1 = await s.fit(msgs, { maxTokens: 200 })
    expect(r1.summarised).toBe(true)
    expect(callCount()).toBe(1)
    const r2 = await s.fit(msgs, { maxTokens: 200 })
    expect(r2.summarised).toBe(true)
    expect(callCount()).toBe(1) // cache hit; no new summariser call
  })

  test("extends summary when toSummarise gains new tail messages", async () => {
    const { adapter, callCount } = mockSummariser("- merged summary")
    const s = new SummarizingStrategy({
      summariser: adapter,
      keepRecent: 2,
      summariseAboveTokens: 1,
      tokenizer: new CharEstimator(),
    })
    const base: Message[] = [
      mkMsg("system", "sys"),
      mkMsg("user", "first"),
      mkMsg("assistant", "first-reply"),
      mkMsg("user", "recent-1"),
      mkMsg("assistant", "recent-2"),
    ]
    await s.fit(base, { maxTokens: 200 })
    expect(callCount()).toBe(1)

    // New turn appended: oldest "recent" rolls into toSummarise.
    const extended: Message[] = [
      ...base,
      mkMsg("user", "new-recent-1"),
      mkMsg("assistant", "new-recent-2"),
    ]
    const r2 = await s.fit(extended, { maxTokens: 200 })
    expect(r2.summarised).toBe(true)
    expect(callCount()).toBe(2) // one extend call, not a fresh full-summary
  })

  test("resetCache forces a fresh summarise", async () => {
    const { adapter, callCount } = mockSummariser("- summary")
    const s = new SummarizingStrategy({
      summariser: adapter,
      keepRecent: 2,
      summariseAboveTokens: 1,
      tokenizer: new CharEstimator(),
    })
    const msgs: Message[] = [
      mkMsg("system", "sys"),
      mkMsg("user", "a"),
      mkMsg("assistant", "b"),
      mkMsg("user", "c"),
      mkMsg("assistant", "d"),
    ]
    await s.fit(msgs, { maxTokens: 200 })
    s.resetCache()
    await s.fit(msgs, { maxTokens: 200 })
    expect(callCount()).toBe(2)
  })
})

describe("TiktokenTokenizer accuracy", () => {
  test("counts close to OpenAI reference for short text", () => {
    const t = new TiktokenTokenizer()
    // "hello world" is ~2 tokens in cl100k_base
    expect(t.count("hello world")).toBeGreaterThanOrEqual(2)
    expect(t.count("hello world")).toBeLessThanOrEqual(3)
  })

  test("countMessages includes overhead", () => {
    const t = new TiktokenTokenizer()
    const just = [mkMsg("user", "hi")]
    expect(t.countMessages(just)).toBeGreaterThan(t.count("hi"))
  })
})
