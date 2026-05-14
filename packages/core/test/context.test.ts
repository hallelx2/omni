import { describe, expect, test } from "bun:test"
import { ulid } from "ulid"
import {
  ContextManager,
  SlidingWindowStrategy,
  TokenBudgetStrategy,
  TiktokenTokenizer,
  CharEstimator,
  chunkToolResult,
  type Message,
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
  test("returns FitResult shape", () => {
    const cm = new ContextManager(new SlidingWindowStrategy())
    cm.append(mkMsg("user", "hi"))
    const r = cm.assemble({ maxMessages: 10 })
    expect(r.messages.length).toBe(1)
    expect(r.dropped).toBe(0)
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
