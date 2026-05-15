import { describe, expect, test } from "bun:test"
import { ulid } from "ulid"
import {
  SummarizingStrategy,
  TokenBudgetStrategy,
  CharEstimator,
  ContextManager,
  type Message,
} from "../src/index.ts"
import { MockAdapter } from "../../adapters/src/mock.ts"

function mk(role: Message["role"], content: string): Message {
  return { id: ulid(), role, content, timestamp: Date.now() }
}

describe("SummarizingStrategy", () => {
  test("passes through when below threshold", async () => {
    const summariser = new MockAdapter({ script: [{ kind: "text", text: "SUMMARY" }] })
    const strategy = new SummarizingStrategy({
      summariser,
      tokenizer: new CharEstimator(),
      summariseAboveTokens: 10_000,
    })
    const msgs = [mk("system", "sys"), mk("user", "hi"), mk("assistant", "hello")]
    const r = await strategy.fit(msgs, { maxTokens: 10_000 })
    expect(r.summarised).toBeFalsy()
    expect(r.messages.length).toBe(msgs.length)
  })

  test("summarises old messages when above threshold", async () => {
    const summariser = new MockAdapter({ script: [{ kind: "text", text: "compressed summary" }] })
    const strategy = new SummarizingStrategy({
      summariser,
      tokenizer: new CharEstimator(),
      summariseAboveTokens: 50,
      keepRecent: 2,
    })
    const messages: Message[] = [
      mk("system", "sys"),
      mk("user", "x".repeat(40)),
      mk("assistant", "x".repeat(40)),
      mk("user", "x".repeat(40)),
      mk("assistant", "x".repeat(40)),
      mk("user", "recent question"),
      mk("assistant", "recent answer"),
    ]
    const r = await strategy.fit(messages, { maxTokens: 200 })
    expect(r.summarised).toBe(true)
    // System + summary + 2 recent
    const view = r.messages
    expect(view.find((m) => m.content.includes("compressed summary"))).toBeDefined()
    expect(view.find((m) => m.content === "recent question")).toBeDefined()
    expect(view.find((m) => m.content === "recent answer")).toBeDefined()
    expect(r.dropped).toBeGreaterThan(0)
  })

  test("preserves system messages across summarisation", async () => {
    const summariser = new MockAdapter({ script: [{ kind: "text", text: "summary" }] })
    const strategy = new SummarizingStrategy({
      summariser,
      tokenizer: new CharEstimator(),
      summariseAboveTokens: 30,
      keepRecent: 1,
    })
    const messages: Message[] = [
      mk("system", "always-keep-system"),
      mk("user", "x".repeat(50)),
      mk("assistant", "x".repeat(50)),
      mk("user", "recent"),
    ]
    const r = await strategy.fit(messages, { maxTokens: 200 })
    expect(r.messages.find((m) => m.content === "always-keep-system")).toBeDefined()
  })

  test("falls back gracefully if summariser errors", async () => {
    const summariser = new MockAdapter({
      script: [{ kind: "error", message: "summariser down" }],
    })
    const strategy = new SummarizingStrategy({
      summariser,
      tokenizer: new CharEstimator(),
      summariseAboveTokens: 30,
    })
    const messages: Message[] = [
      mk("user", "x".repeat(100)),
      mk("assistant", "x".repeat(100)),
      mk("user", "recent"),
    ]
    // Should not throw; just falls back to inner strategy
    const r = await strategy.fit(messages, { maxTokens: 200, reserveTokensForOutput: 50 })
    expect(r.summarised).toBeFalsy()
  })

  test("ContextManager.assemble awaits async strategy", async () => {
    const summariser = new MockAdapter({ script: [{ kind: "text", text: "S" }] })
    const cm = new ContextManager(
      new SummarizingStrategy({
        summariser,
        tokenizer: new CharEstimator(),
        summariseAboveTokens: 30,
        keepRecent: 1,
      }),
    )
    cm.append(mk("user", "x".repeat(100)))
    cm.append(mk("assistant", "x".repeat(100)))
    cm.append(mk("user", "recent"))
    const r = await cm.assemble({ maxTokens: 200 })
    expect(r.messages).toBeDefined()
  })
})

describe("Sync strategies still work via the awaited path", () => {
  test("TokenBudgetStrategy through await", async () => {
    const cm = new ContextManager(new TokenBudgetStrategy(new CharEstimator()))
    cm.append(mk("user", "hi"))
    const r = await cm.assemble({ maxTokens: 1000 })
    expect(r.messages.length).toBe(1)
    expect(r.dropped).toBe(0)
  })
})
