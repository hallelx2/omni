import { describe, expect, test } from "bun:test"
import { MockAdapter } from "../../adapters/src/mock.ts"
import { Critic, parseCritique } from "../src/critic.ts"

describe("parseCritique", () => {
  test("parses well-formed response", () => {
    const c = parseCritique("VERDICT=ok SCORE=0.9\nISSUES: NONE")
    expect(c.verdict).toBe("ok")
    expect(c.score).toBe(0.9)
    expect(c.issues).toEqual([])
  })

  test("parses concern verdict with issues", () => {
    const c = parseCritique("VERDICT=concern SCORE=0.5\nISSUES: didn't verify; partial result")
    expect(c.verdict).toBe("concern")
    expect(c.score).toBe(0.5)
    expect(c.issues).toEqual(["didn't verify", "partial result"])
  })

  test("clamps score to [0,1]", () => {
    expect(parseCritique("VERDICT=fail SCORE=2.5\nISSUES: NONE").score).toBe(1)
    expect(parseCritique("VERDICT=fail SCORE=-1\nISSUES: NONE").score).toBe(0)
  })

  test("missing verdict defaults to concern", () => {
    const c = parseCritique("This is garbage")
    expect(c.verdict).toBe("concern")
  })
})

describe("Critic", () => {
  test("reviewMessages produces a Critique", async () => {
    const model = new MockAdapter({
      script: [{ kind: "text", text: "VERDICT=ok SCORE=0.85\nISSUES: NONE" }],
    })
    const critic = new Critic(model)
    const c = await critic.reviewMessages([
      { id: "1", role: "user", content: "hi", timestamp: 0 },
      { id: "2", role: "assistant", content: "hello", timestamp: 0 },
    ])
    expect(c.verdict).toBe("ok")
    expect(c.score).toBe(0.85)
  })

  test("reviewToolResult flags missing expectation", async () => {
    const model = new MockAdapter({
      script: [
        {
          kind: "text",
          text: "VERDICT=fail SCORE=0.2\nISSUES: result is empty; expected list of files",
        },
      ],
    })
    const critic = new Critic(model)
    const c = await critic.reviewToolResult("glob", { pattern: "*.ts" }, [], "find typescript files")
    expect(c.verdict).toBe("fail")
    expect(c.issues.length).toBe(2)
  })

  test("shouldRetry trips on fail+low-score", async () => {
    const model = new MockAdapter({
      script: [{ kind: "text", text: "VERDICT=fail SCORE=0.2\nISSUES: bad" }],
    })
    const critic = new Critic(model, { retryBelow: 0.4 })
    const c = await critic.reviewMessages([])
    expect(critic.shouldRetry(c)).toBe(true)
  })

  test("shouldRetry does not trip on concern", async () => {
    const model = new MockAdapter({
      script: [{ kind: "text", text: "VERDICT=concern SCORE=0.2\nISSUES: bad" }],
    })
    const critic = new Critic(model)
    const c = await critic.reviewMessages([])
    expect(critic.shouldRetry(c)).toBe(false)
  })
})
