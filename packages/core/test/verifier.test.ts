import { describe, expect, test } from "bun:test"
import { z } from "zod"
import {
  Engine,
  AllowAllPermissions,
  selectApplicableVerifiers,
  truncateFeedback,
  type EngineEvent,
  type Tool,
  type Verifier,
  type ToolContext,
} from "../src/index.ts"
import { MockAdapter } from "../../adapters/src/mock.ts"

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeEcho(): Tool<{ text: string }, { text: string }> {
  return {
    name: "echo",
    description: "Echo input",
    permission: "auto",
    schema: z.object({ text: z.string() }),
    async execute(args) {
      return { text: args.text }
    },
  }
}

function makeWrite(): Tool<{ content: string }, { wrote: string }> {
  return {
    name: "write",
    description: "Pretend to write",
    permission: "auto",
    schema: z.object({ content: z.string() }),
    async execute(args) {
      return { wrote: args.content }
    },
  }
}

async function collect(stream: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const out: EngineEvent[] = []
  for await (const ev of stream) out.push(ev)
  return out
}

// ─── Unit tests ────────────────────────────────────────────────────────────

describe("selectApplicableVerifiers", () => {
  test("verifiers without appliesTo run for every tool", () => {
    const v: Verifier = { name: "all", verify: async () => ({ verifier: "all", status: "pass" }) }
    expect(selectApplicableVerifiers([v], "anything")).toEqual([v])
  })

  test("scoped verifiers only run for matching tool names", () => {
    const scoped: Verifier = {
      name: "edits-only",
      appliesTo: ["edit", "apply_patch"],
      verify: async () => ({ verifier: "edits-only", status: "pass" }),
    }
    expect(selectApplicableVerifiers([scoped], "edit").length).toBe(1)
    expect(selectApplicableVerifiers([scoped], "bash").length).toBe(0)
  })

  test("preserves registration order", () => {
    const a: Verifier = { name: "a", verify: async () => ({ verifier: "a", status: "pass" }) }
    const b: Verifier = { name: "b", verify: async () => ({ verifier: "b", status: "pass" }) }
    const c: Verifier = { name: "c", verify: async () => ({ verifier: "c", status: "pass" }) }
    expect(selectApplicableVerifiers([a, b, c], "x").map((v) => v.name)).toEqual(["a", "b", "c"])
  })
})

describe("truncateFeedback", () => {
  test("passes through small text", () => {
    expect(truncateFeedback("short")).toBe("short")
  })

  test("elides middle when oversized", () => {
    const big = "x".repeat(20_000)
    const out = truncateFeedback(big, 1_000)
    expect(out.length).toBeLessThan(big.length)
    expect(out).toContain("elided")
    expect(out.startsWith("x")).toBe(true)
    expect(out.endsWith("x")).toBe(true)
  })
})

// ─── Engine integration ────────────────────────────────────────────────────

describe("Engine — verifier integration", () => {
  test("passing verifier emits start + result, no message change", async () => {
    let invoked = 0
    const v: Verifier = {
      name: "always-ok",
      async verify() {
        invoked++
        return { verifier: "always-ok", status: "pass" }
      },
    }
    const engine = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "echo", args: { text: "hi" } },
          { kind: "text", text: "done" },
        ],
      }),
      tools: [makeEcho()],
      verifiers: [v],
    })
    const events = await collect(engine.run("go"))
    expect(invoked).toBe(1)
    const starts = events.filter((e) => e.type === "verifier.start")
    const results = events.filter((e) => e.type === "verifier.result")
    expect(starts.length).toBe(1)
    expect(results.length).toBe(1)
    if (results[0]!.type === "verifier.result") {
      expect(results[0]!.status).toBe("pass")
      expect(results[0]!.verifier).toBe("always-ok")
    }
  })

  test("failing verifier appends feedback to the tool message in history", async () => {
    const v: Verifier = {
      name: "tests",
      async verify() {
        return {
          verifier: "tests",
          status: "fail",
          reason: "2 tests failed",
          feedback: "FAIL: test/foo.test.ts > should add\n  expected 3, got 4",
        }
      },
    }
    const engine = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "echo", args: { text: "hi" } },
          { kind: "text", text: "done" },
        ],
      }),
      tools: [makeEcho()],
      verifiers: [v],
    })
    await collect(engine.run("go"))
    const history = engine.history()
    const toolMsg = history.find((m) => m.role === "tool")
    expect(toolMsg).toBeDefined()
    // Tool message should contain both the primary result AND verifier feedback
    expect(toolMsg!.content).toContain("hi") // echo result
    expect(toolMsg!.content).toContain("[verifier:tests] FAILED")
    expect(toolMsg!.content).toContain("expected 3, got 4")
  })

  test("verifier scoped to other tools doesn't run", async () => {
    let invoked = 0
    const v: Verifier = {
      name: "edits-only",
      appliesTo: ["edit", "apply_patch"],
      async verify() {
        invoked++
        return { verifier: "edits-only", status: "pass" }
      },
    }
    const engine = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "echo", args: { text: "x" } },
          { kind: "text", text: "done" },
        ],
      }),
      tools: [makeEcho()],
      verifiers: [v],
    })
    await collect(engine.run("go"))
    expect(invoked).toBe(0)
  })

  test("verifier that throws is treated as skip, not as run-failure", async () => {
    const v: Verifier = {
      name: "boom",
      async verify() {
        throw new Error("buggy verifier")
      },
    }
    const engine = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "echo", args: { text: "x" } },
          { kind: "text", text: "done" },
        ],
      }),
      tools: [makeEcho()],
      verifiers: [v],
    })
    const events = await collect(engine.run("go"))
    const result = events.find((e) => e.type === "verifier.result")
    expect(result).toBeDefined()
    if (result?.type === "verifier.result") {
      expect(result.status).toBe("skip")
      expect(result.reason).toContain("buggy verifier")
    }
    // Engine still completes normally
    expect(events.find((e) => e.type === "engine.done")?.type).toBe("engine.done")
  })

  test("multiple failing verifiers stack their feedback in one tool message", async () => {
    const v1: Verifier = {
      name: "lint",
      async verify() {
        return { verifier: "lint", status: "fail", feedback: "no-unused-vars violated" }
      },
    }
    const v2: Verifier = {
      name: "typecheck",
      async verify() {
        return { verifier: "typecheck", status: "fail", feedback: "TS2304: cannot find name 'foo'" }
      },
    }
    const engine = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "write", args: { content: "x" } },
          { kind: "text", text: "done" },
        ],
      }),
      tools: [makeWrite()],
      verifiers: [v1, v2],
    })
    await collect(engine.run("go"))
    const toolMsg = engine.history().find((m) => m.role === "tool")
    expect(toolMsg!.content).toContain("[verifier:lint] FAILED")
    expect(toolMsg!.content).toContain("[verifier:typecheck] FAILED")
    expect(toolMsg!.content).toContain("no-unused-vars")
    expect(toolMsg!.content).toContain("TS2304")
  })

  test("model sees verifier feedback on the next iteration and can correct", async () => {
    // First call: model writes bad code. Verifier fails. Second iteration:
    // model sees the failure feedback and tries again.
    let invocations = 0
    const v: Verifier = {
      name: "tests",
      async verify() {
        invocations++
        // First write fails verification; second one passes.
        return invocations === 1
          ? { verifier: "tests", status: "fail", feedback: "tests broke" }
          : { verifier: "tests", status: "pass" }
      },
    }
    const engine = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "write", args: { content: "buggy" } },
          { kind: "tool", name: "write", args: { content: "fixed" } },
          { kind: "text", text: "fixed it" },
        ],
      }),
      tools: [makeWrite()],
      verifiers: [v],
    })
    const events = await collect(engine.run("go"))
    const results = events.filter((e) => e.type === "verifier.result")
    expect(results.length).toBe(2)
    if (results[0]?.type === "verifier.result" && results[1]?.type === "verifier.result") {
      expect(results[0].status).toBe("fail")
      expect(results[1].status).toBe("pass")
    }
  })

  test("verifier progress events are surfaced", async () => {
    const v: Verifier = {
      name: "slow-tests",
      async verify(ctx) {
        ctx.onProgress?.("running test 1/3")
        ctx.onProgress?.("running test 2/3")
        ctx.onProgress?.("running test 3/3")
        return { verifier: "slow-tests", status: "pass" }
      },
    }
    const engine = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "echo", args: { text: "x" } },
          { kind: "text", text: "done" },
        ],
      }),
      tools: [makeEcho()],
      verifiers: [v],
    })
    const events = await collect(engine.run("go"))
    const progress = events.filter((e) => e.type === "verifier.progress")
    expect(progress.length).toBe(3)
    if (progress[0]?.type === "verifier.progress") {
      expect(progress[0].verifier).toBe("slow-tests")
      expect(progress[0].message).toContain("1/3")
    }
  })
})
