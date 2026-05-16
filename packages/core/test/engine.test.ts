import { describe, expect, test } from "bun:test"
import { z } from "zod"
import {
  Engine,
  AllowAllPermissions,
  DenyAllPermissions,
  AskPermissions,
  type EngineEvent,
  type Tool,
  type ToolContext,
} from "../src/index.ts"
import { MockAdapter, type MockScript } from "../../adapters/src/mock.ts"

// ─── Test fixtures ─────────────────────────────────────────────────────────

function makeEcho(name = "echo"): Tool<{ text: string }, { text: string }> {
  return {
    name,
    description: "Echo input back",
    permission: "auto",
    schema: z.object({ text: z.string() }),
    async execute(args) {
      return { text: args.text }
    },
  }
}

function makeSlowTool(name: string, ms: number): Tool<{ tag: string }, { tag: string }> {
  return {
    name,
    description: "Sleeps then returns its tag",
    permission: "auto",
    schema: z.object({ tag: z.string() }),
    async execute(args, ctx: ToolContext) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, ms)
        ctx.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t)
            reject(new DOMException("Aborted", "AbortError"))
          },
          { once: true },
        )
      })
      return { tag: args.tag }
    },
  }
}

function makeThrowing(name = "boom"): Tool<{}, never> {
  return {
    name,
    description: "Always throws",
    permission: "auto",
    schema: z.object({}),
    async execute() {
      throw new Error("intentional failure")
    },
  }
}

async function collect(stream: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const out: EngineEvent[] = []
  for await (const ev of stream) out.push(ev)
  return out
}

function only<T extends EngineEvent["type"]>(
  events: readonly EngineEvent[],
  type: T,
): Array<Extract<EngineEvent, { type: T }>> {
  return events.filter((e) => e.type === type) as Array<Extract<EngineEvent, { type: T }>>
}

// ─── Basic loop ────────────────────────────────────────────────────────────

describe("Engine — basic loop", () => {
  test("text-only response ends with model_done", async () => {
    const engine = new Engine({
      model: new MockAdapter({ script: [{ kind: "text", text: "hello" }] }),
      tools: [],
    })
    const events = await collect(engine.run("hi"))
    expect(only(events, "engine.start").length).toBe(1)
    const done = only(events, "engine.done")
    expect(done.length).toBe(1)
    expect(done[0]!.reason).toBe("model_done")
    expect(only(events, "model.delta").map((e) => e.text).join("")).toBe("hello")
  })

  test("tool call → result → text completes in 2 iterations", async () => {
    const script: MockScript[] = [
      { kind: "tool", name: "echo", args: { text: "ping" } },
      { kind: "text", text: "did it" },
    ]
    const engine = new Engine({
      model: new MockAdapter({ script }),
      tools: [makeEcho()],
    })
    const events = await collect(engine.run("go"))

    expect(only(events, "engine.iteration").length).toBe(2)
    const result = only(events, "tool.result")
    expect(result.length).toBe(1)
    expect(result[0]!.result).toEqual({ text: "ping" })
    expect(only(events, "engine.done")[0]!.reason).toBe("model_done")
  })

  test("emits permission lifecycle in order", async () => {
    const script: MockScript[] = [
      { kind: "tool", name: "echo", args: { text: "x" } },
      { kind: "text", text: "done" },
    ]
    const engine = new Engine({
      model: new MockAdapter({ script }),
      tools: [makeEcho()],
      permissions: new AllowAllPermissions(),
    })
    const events = await collect(engine.run("go"))
    const seq = events
      .map((e) => e.type)
      .filter((t) => t.startsWith("tool.") || t.startsWith("model.tool_call"))
    expect(seq).toEqual([
      "model.tool_call_start",
      "model.tool_call_done",
      "tool.permission_requested",
      "tool.permission_granted",
      "tool.start",
      "tool.result",
    ])
  })
})

// ─── Validation & permissions ──────────────────────────────────────────────

describe("Engine — validation & permissions", () => {
  test("invalid args trigger tool.invalid and feed error back", async () => {
    const script: MockScript[] = [
      { kind: "tool", name: "echo", args: { wrong: 42 } }, // missing required `text`
      { kind: "text", text: "ok, giving up" },
    ]
    const engine = new Engine({
      model: new MockAdapter({ script }),
      tools: [makeEcho()],
    })
    const events = await collect(engine.run("go"))
    expect(only(events, "tool.invalid").length).toBe(1)
    expect(only(events, "tool.result").length).toBe(0)
    expect(only(events, "engine.done")[0]!.reason).toBe("model_done")
    // Conversation history should now contain a tool error message so the
    // model can self-correct in a real run.
    const history = engine.history()
    const lastTool = [...history].reverse().find((m) => m.role === "tool")
    expect(lastTool?.content.includes("Invalid arguments")).toBe(true)
  })

  test("call to a tool excluded by enabledTools yields tool.invalid with the allowed list", async () => {
    const script: MockScript[] = [
      { kind: "tool", name: "echo", args: { text: "x" } },
      { kind: "text", text: "ok" },
    ]
    const engine = new Engine({
      model: new MockAdapter({ script }),
      tools: [makeEcho("echo"), makeEcho("other")],
    })
    const events = await collect(engine.run("go", { enabledTools: new Set(["other"]) }))
    const invalid = only(events, "tool.invalid")
    expect(invalid.length).toBe(1)
    if (invalid[0]!.type === "tool.invalid") {
      expect(invalid[0]!.reason).toContain("'echo' is not enabled")
      expect(invalid[0]!.reason).toContain("allowed: other")
    }
    expect(only(events, "tool.result").length).toBe(0)
  })

  test("permission denial emits permission_denied and feeds error", async () => {
    const script: MockScript[] = [
      { kind: "tool", name: "echo", args: { text: "x" } },
      { kind: "text", text: "ok" },
    ]
    const engine = new Engine({
      model: new MockAdapter({ script }),
      tools: [makeEcho()],
      permissions: new DenyAllPermissions(),
    })
    const events = await collect(engine.run("go"))
    expect(only(events, "tool.permission_denied").length).toBe(1)
    expect(only(events, "tool.start").length).toBe(0)
  })

  test("AskPermissions delegates to handler with correct args", async () => {
    let asked = false
    const ask = async () => {
      asked = true
      return "deny" as const
    }
    const tool = { ...makeEcho(), permission: "ask" as const }
    const engine = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "echo", args: { text: "x" } },
          { kind: "text", text: "ok" },
        ],
      }),
      tools: [tool],
      permissions: new AskPermissions(ask),
    })
    await collect(engine.run("go"))
    expect(asked).toBe(true)
  })

  test("unknown tool emits tool.invalid", async () => {
    const engine = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "ghost", args: {} },
          { kind: "text", text: "ok" },
        ],
      }),
      tools: [makeEcho()],
    })
    const events = await collect(engine.run("go"))
    expect(only(events, "tool.invalid").length).toBe(1)
    expect(only(events, "tool.invalid")[0]!.reason).toContain("unknown tool")
  })
})

// ─── Bounds & safety ───────────────────────────────────────────────────────

describe("Engine — bounds & safety", () => {
  test("max iterations halts the loop", async () => {
    // Script cycles forever — without max iter cap this would never stop.
    const script: MockScript[] = [{ kind: "tool", name: "echo", args: { text: "n" } }]
    const engine = new Engine({
      model: new MockAdapter({ script }),
      tools: [makeEcho()],
      maxIterations: 3,
      loopDetectionThreshold: 999, // disable loop detection for this test
    })
    const events = await collect(engine.run("go"))
    const done = only(events, "engine.done")[0]!
    expect(done.reason).toBe("max_iterations")
    expect(only(events, "engine.iteration").length).toBe(3)
  })

  test("loop detection halts when same call set repeats", async () => {
    // Same call indefinitely; loop detector should trip at threshold 3.
    const script: MockScript[] = [{ kind: "tool", name: "echo", args: { text: "same" } }]
    const engine = new Engine({
      model: new MockAdapter({ script }),
      tools: [makeEcho()],
      maxIterations: 25,
      loopDetectionThreshold: 3,
    })
    const events = await collect(engine.run("go"))
    expect(only(events, "engine.loop_detected").length).toBe(1)
    expect(only(events, "engine.done")[0]!.reason).toBe("loop_detected")
  })

  test("abort halts mid-loop", async () => {
    const script: MockScript[] = [{ kind: "tool", name: "slow", args: { tag: "x" } }]
    const engine = new Engine({
      model: new MockAdapter({ script }),
      tools: [makeSlowTool("slow", 5_000)],
      maxIterations: 25,
    })
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 50)
    const events = await collect(engine.run("go", { signal: ac.signal }))
    const done = only(events, "engine.done")[0]!
    expect(done.reason).toBe("aborted")
    // No tool result should have been emitted (we aborted before completion).
    expect(only(events, "tool.result").length).toBe(0)
  })

  test("engine.abort() halts external-signal-less runs", async () => {
    const engine = new Engine({
      model: new MockAdapter({ script: [{ kind: "tool", name: "slow", args: { tag: "x" } }] }),
      tools: [makeSlowTool("slow", 5_000)],
    })
    setTimeout(() => engine.abort(), 50)
    const events = await collect(engine.run("go"))
    expect(only(events, "engine.done")[0]!.reason).toBe("aborted")
  })
})

// ─── Errors & retries ──────────────────────────────────────────────────────

describe("Engine — errors", () => {
  test("tool exception is captured as tool.error", async () => {
    const script: MockScript[] = [
      { kind: "tool", name: "boom", args: {} },
      { kind: "text", text: "moved on" },
    ]
    const engine = new Engine({
      model: new MockAdapter({ script }),
      tools: [makeThrowing("boom")],
    })
    const events = await collect(engine.run("go"))
    const err = only(events, "tool.error")
    expect(err.length).toBe(1)
    expect(err[0]!.error.message).toContain("intentional failure")
  })

  test("model error is classified and surfaced", async () => {
    const engine = new Engine({
      model: new MockAdapter({ script: [{ kind: "error", message: "boom" }] }),
      tools: [],
      maxRetriesPerIteration: 0,
    })
    const events = await collect(engine.run("go"))
    expect(only(events, "engine.error").length).toBeGreaterThanOrEqual(1)
    expect(only(events, "engine.done")[0]!.reason).toBe("fatal_error")
  })
})

// ─── Parallel tool calls ───────────────────────────────────────────────────

describe("Engine — parallel tool calls", () => {
  test("multiple tool calls in one turn run concurrently", async () => {
    const script: MockScript[] = [
      {
        kind: "tools",
        calls: [
          { name: "slow", args: { tag: "a" } },
          { name: "slow", args: { tag: "b" } },
          { name: "slow", args: { tag: "c" } },
        ],
      },
      { kind: "text", text: "done" },
    ]
    const engine = new Engine({
      model: new MockAdapter({ script }),
      tools: [makeSlowTool("slow", 100)],
    })
    const t0 = Date.now()
    const events = await collect(engine.run("go"))
    const elapsed = Date.now() - t0
    // Three 100ms tools sequentially would be 300ms+; concurrently ~100–200ms.
    expect(elapsed).toBeLessThan(250)
    expect(only(events, "tool.result").length).toBe(3)
    const tags = only(events, "tool.result").map((e) => (e.result as { tag: string }).tag).sort()
    expect(tags).toEqual(["a", "b", "c"])
  })
})

// ─── Usage accumulation ────────────────────────────────────────────────────

describe("Engine — usage", () => {
  test("accumulates token usage across turns", async () => {
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    const script: MockScript[] = [
      { kind: "tool", name: "echo", args: { text: "x" } },
      { kind: "text", text: "ok" },
    ]
    const engine = new Engine({
      model: new MockAdapter({ script, usage }),
      tools: [makeEcho()],
    })
    await collect(engine.run("go"))
    const total = engine.usage()
    expect(total.callCount).toBe(2)
    expect(total.totalTokens).toBe(30)
    expect(total.promptTokens).toBe(20)
    expect(total.completionTokens).toBe(10)
  })
})

// ─── Snapshot / restore ────────────────────────────────────────────────────

describe("Engine — snapshot/restore", () => {
  test("snapshot captures messages and usage", async () => {
    const engine = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "echo", args: { text: "x" } },
          { kind: "text", text: "ok" },
        ],
        usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      }),
      tools: [makeEcho()],
    })
    await collect(engine.run("go"))
    const snap = engine.snapshot()
    expect(snap.messages.length).toBeGreaterThan(0)
    expect(snap.usage.callCount).toBe(2)

    // New engine restores the same state.
    const engine2 = new Engine({
      model: new MockAdapter({ script: [{ kind: "text", text: "later" }] }),
      tools: [makeEcho()],
    })
    engine2.restore(snap)
    expect(engine2.history().length).toBe(snap.messages.length)
    expect(engine2.usage().totalTokens).toBe(snap.usage.totalTokens)
    expect(engine2.sessionId()).toBe(snap.sessionId)
  })

  test("resumed session continues to emit the original sessionId", async () => {
    const engine = new Engine({
      model: new MockAdapter({ script: [{ kind: "text", text: "first" }] }),
      tools: [],
    })
    await collect(engine.run("first turn"))
    const snap = engine.snapshot()

    const engine2 = new Engine({
      model: new MockAdapter({ script: [{ kind: "text", text: "second" }] }),
      tools: [],
    })
    engine2.restore(snap)
    const events = await collect(engine2.run("second turn"))
    const start = only(events, "engine.start")[0]!
    expect(start.sessionId).toBe(snap.sessionId)
  })
})

// ─── Retries ───────────────────────────────────────────────────────────────

describe("Engine — retries", () => {
  test("retryable error retries within the same iteration and then succeeds", async () => {
    // First model call: rate-limited (status 429 → retryable).
    // Second call (the retry, no new iteration consumed): final text.
    const script: MockScript[] = [
      { kind: "error", message: "rate limited", status: 429 },
      { kind: "text", text: "second try worked" },
    ]
    const engine = new Engine({
      model: new MockAdapter({ script }),
      tools: [],
      maxRetriesPerIteration: 2,
    })
    const events = await collect(engine.run("go"))
    expect(only(events, "engine.retrying").length).toBe(1)
    expect(only(events, "engine.retrying")[0]!.reason).toBe("rate_limit")
    expect(only(events, "engine.error").length).toBe(0)
    expect(only(events, "engine.done")[0]!.reason).toBe("model_done")
    // Should still be iteration 1 — retries don't consume iteration budget.
    expect(only(events, "engine.iteration").length).toBe(1)
  })

  test("non-retryable error surfaces as fatal immediately", async () => {
    const script: MockScript[] = [
      { kind: "error", message: "bad request", status: 400 },
      { kind: "text", text: "would-have-been-retry" },
    ]
    const engine = new Engine({
      model: new MockAdapter({ script }),
      tools: [],
    })
    const events = await collect(engine.run("go"))
    expect(only(events, "engine.retrying").length).toBe(0)
    expect(only(events, "engine.error").length).toBe(1)
    expect(only(events, "engine.error")[0]!.error.category).toBe("invalid_request")
    expect(only(events, "engine.done")[0]!.reason).toBe("fatal_error")
  })

  test("exhausting retries gives up with fatal", async () => {
    // Three retryable errors, but maxRetries=2 → after 2 retries (3 attempts), fatal.
    const script: MockScript[] = [
      { kind: "error", message: "503", status: 503 },
      { kind: "error", message: "503", status: 503 },
      { kind: "error", message: "503", status: 503 },
      { kind: "text", text: "never reached" },
    ]
    const engine = new Engine({
      model: new MockAdapter({ script }),
      tools: [],
      maxRetriesPerIteration: 2,
    })
    const events = await collect(engine.run("go"))
    expect(only(events, "engine.retrying").length).toBe(2)
    expect(only(events, "engine.error").length).toBe(1)
    expect(only(events, "engine.done")[0]!.reason).toBe("fatal_error")
  })
})

// ─── Parallel tool calls — mixed outcomes ──────────────────────────────────

describe("Engine — parallel tool calls (mixed)", () => {
  test("one tool succeeds while another fails — both events surface", async () => {
    const script: MockScript[] = [
      {
        kind: "tools",
        calls: [
          { name: "echo", args: { text: "ok" } },
          { name: "boom", args: {} },
        ],
      },
      { kind: "text", text: "done" },
    ]
    const engine = new Engine({
      model: new MockAdapter({ script }),
      tools: [makeEcho(), makeThrowing("boom")],
    })
    const events = await collect(engine.run("go"))
    expect(only(events, "tool.result").length).toBe(1)
    expect(only(events, "tool.error").length).toBe(1)
    expect(only(events, "engine.done")[0]!.reason).toBe("model_done")
  })
})

// ─── Tool progress events ──────────────────────────────────────────────────

describe("Engine — tool progress", () => {
  test("tool.progress events flow through the stream in order", async () => {
    const reporter: Tool<{}, { ok: true }> = {
      name: "report",
      description: "Reports progress",
      permission: "auto",
      schema: z.object({}),
      async execute(_args, ctx: ToolContext) {
        ctx.onProgress?.("step 1")
        await new Promise((r) => setTimeout(r, 5))
        ctx.onProgress?.("step 2")
        await new Promise((r) => setTimeout(r, 5))
        ctx.onProgress?.("step 3")
        return { ok: true as const }
      },
    }
    const script: MockScript[] = [
      { kind: "tool", name: "report", args: {} },
      { kind: "text", text: "done" },
    ]
    const engine = new Engine({
      model: new MockAdapter({ script }),
      tools: [reporter],
    })
    const events = await collect(engine.run("go"))
    const messages = only(events, "tool.progress").map((e) => e.message)
    expect(messages).toEqual(["step 1", "step 2", "step 3"])
    // Result must come AFTER all progress events.
    const order = events
      .map((e) => e.type)
      .filter((t) => t === "tool.progress" || t === "tool.result")
    expect(order).toEqual([
      "tool.progress",
      "tool.progress",
      "tool.progress",
      "tool.result",
    ])
  })
})

// ─── Tracer & warnings ────────────────────────────────────────────────────

describe("Engine — tracer", () => {
  test("tracer receives every emitted event in order", async () => {
    const seen: string[] = []
    const engine = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "echo", args: { text: "x" } },
          { kind: "text", text: "done" },
        ],
      }),
      tools: [makeEcho()],
      tracer: (ev) => seen.push(ev.type),
    })
    const events = await collect(engine.run("go"))
    expect(seen).toEqual(events.map((e) => e.type))
  })

  test("tracer throw disables tracer and emits engine.warning", async () => {
    let calls = 0
    const engine = new Engine({
      model: new MockAdapter({ script: [{ kind: "text", text: "hi" }] }),
      tools: [],
      tracer: () => {
        calls++
        throw new Error("tracer crashed")
      },
    })
    const events = await collect(engine.run("go"))
    const warns = only(events, "engine.warning")
    expect(warns.length).toBe(1)
    expect(warns[0]!.category).toBe("tracer")
    // tracer was called once before being disabled (or maybe twice — the
    // first time it threw, second wouldn't be called since disabled)
    expect(calls).toBe(1)
  })
})

describe("Engine — permission gate exceptions", () => {
  test("gate throwing emits engine.warning and treats as deny", async () => {
    class CrashingGate {
      async check() {
        throw new Error("gate exploded")
      }
    }
    const engine = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "echo", args: { text: "x" } },
          { kind: "text", text: "done" },
        ],
      }),
      tools: [makeEcho()],
      permissions: new CrashingGate(),
    })
    const events = await collect(engine.run("go"))
    const warns = only(events, "engine.warning")
    expect(warns.length).toBe(1)
    expect(warns[0]!.category).toBe("permission_gate")
    expect(only(events, "tool.permission_denied").length).toBe(1)
    expect(only(events, "tool.start").length).toBe(0)
  })
})

// ─── ReAct fallback ────────────────────────────────────────────────────────

describe("Engine — ReAct fallback", () => {
  test("extracts a synthetic tool call from Action:/Action Input: text", async () => {
    const script: MockScript[] = [
      {
        kind: "text",
        text:
          "Thought: I should call echo.\nAction: echo\nAction Input: {\"text\":\"from-react\"}\n",
      },
      { kind: "text", text: "done" },
    ]
    const engine = new Engine({
      model: new MockAdapter({ script }),
      tools: [makeEcho()],
      enableReActFallback: true,
    })
    const events = await collect(engine.run("go"))
    const result = only(events, "tool.result")
    expect(result.length).toBe(1)
    expect((result[0]!.result as { text: string }).text).toBe("from-react")
  })

  test("disabled by default", async () => {
    const script: MockScript[] = [
      {
        kind: "text",
        text: "Action: echo\nAction Input: {\"text\":\"x\"}\n",
      },
    ]
    const engine = new Engine({
      model: new MockAdapter({ script }),
      tools: [makeEcho()],
    })
    const events = await collect(engine.run("go"))
    expect(only(events, "tool.result").length).toBe(0)
    expect(only(events, "engine.done")[0]!.reason).toBe("model_done")
  })
})
