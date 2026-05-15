import { describe, expect, test } from "bun:test"
import { z } from "zod"
import {
  Engine,
  AllowAllPermissions,
  type Tool,
  type HookModule,
  type EngineEvent,
} from "../src/index.ts"
import { MockAdapter, type MockScript } from "../../adapters/src/mock.ts"

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

async function collect(stream: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const out: EngineEvent[] = []
  for await (const ev of stream) out.push(ev)
  return out
}

describe("Engine hooks — preToolUse", () => {
  test("hook returning continue:false denies the tool call", async () => {
    const hook: HookModule = {
      name: "blocker",
      preToolUse: async () => ({ continue: false, reason: "policy" }),
    }
    const engine = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "echo", args: { text: "hi" } },
          { kind: "text", text: "done" },
        ],
      }),
      tools: [makeEcho()],
      hooks: [hook],
    })
    const events = await collect(engine.run("go"))
    const denied = events.filter((e) => e.type === "tool.permission_denied")
    const results = events.filter((e) => e.type === "tool.result")
    expect(denied.length).toBe(1)
    expect(results.length).toBe(0)
  })

  test("hook rewrites args before execute", async () => {
    const hook: HookModule = {
      name: "rewriter",
      preToolUse: async () => ({ args: { text: "rewritten" } }),
    }
    const engine = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "echo", args: { text: "original" } },
          { kind: "text", text: "done" },
        ],
      }),
      tools: [makeEcho()],
      hooks: [hook],
    })
    const events = await collect(engine.run("go"))
    const result = events.find((e) => e.type === "tool.result")
    if (result?.type === "tool.result") {
      expect((result.result as { text: string }).text).toBe("rewritten")
    } else {
      throw new Error("expected tool.result")
    }
  })

  test("multiple hooks compose left-to-right; later sees earlier rewrites", async () => {
    const order: string[] = []
    const hooks: HookModule[] = [
      {
        name: "first",
        preToolUse: async (_t, call) => {
          order.push("first:" + (call.args as { text: string }).text)
          return { args: { text: "after-first" } }
        },
      },
      {
        name: "second",
        preToolUse: async (_t, call) => {
          order.push("second:" + (call.args as { text: string }).text)
          return { args: { text: "after-second" } }
        },
      },
    ]
    const engine = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "echo", args: { text: "original" } },
          { kind: "text", text: "done" },
        ],
      }),
      tools: [makeEcho()],
      hooks,
    })
    const events = await collect(engine.run("go"))
    expect(order).toEqual(["first:original", "second:after-first"])
    const result = events.find((e) => e.type === "tool.result")
    if (result?.type === "tool.result") {
      expect((result.result as { text: string }).text).toBe("after-second")
    }
  })

  test("hook throwing is swallowed; tool still runs", async () => {
    const hooks: HookModule[] = [
      {
        name: "boom",
        preToolUse: async () => {
          throw new Error("hook error")
        },
      },
    ]
    const engine = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "echo", args: { text: "hi" } },
          { kind: "text", text: "done" },
        ],
      }),
      tools: [makeEcho()],
      hooks,
    })
    const events = await collect(engine.run("go"))
    expect(events.find((e) => e.type === "tool.result")).toBeDefined()
  })
})

describe("Engine hooks — postToolUse", () => {
  test("hook can replace the tool result", async () => {
    const hooks: HookModule[] = [
      {
        name: "redactor",
        postToolUse: async () => ({ result: { text: "REDACTED" } }),
      },
    ]
    const engine = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "echo", args: { text: "secret" } },
          { kind: "text", text: "done" },
        ],
      }),
      tools: [makeEcho()],
      hooks,
    })
    const events = await collect(engine.run("go"))
    const result = events.find((e) => e.type === "tool.result")
    if (result?.type === "tool.result") {
      expect((result.result as { text: string }).text).toBe("REDACTED")
    }
  })
})

describe("Engine hooks — preModel", () => {
  test("hook can rewrite the messages sent to the model", async () => {
    let seenMessageCount = 0
    const hooks: HookModule[] = [
      {
        name: "injector",
        preModel: async (msgs) => {
          seenMessageCount = msgs.length
          return { messages: msgs }
        },
      },
    ]
    const engine = new Engine({
      model: new MockAdapter({ script: [{ kind: "text", text: "ok" }] }),
      tools: [],
      hooks,
      systemPrompt: "system",
    })
    await collect(engine.run("go"))
    expect(seenMessageCount).toBeGreaterThan(0)
  })
})

describe("Engine hooks — session lifecycle", () => {
  test("onSessionStart fires once, onSessionEnd fires per run", async () => {
    let starts = 0
    let ends: string[] = []
    const hooks: HookModule[] = [
      {
        name: "lifecycle",
        onSessionStart: async () => {
          starts++
        },
        onSessionEnd: async (_id, reason) => {
          ends.push(reason)
        },
      },
    ]
    const engine = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "text", text: "first" },
          { kind: "text", text: "second" },
        ],
      }),
      tools: [],
      hooks,
    })
    await collect(engine.run("go"))
    await collect(engine.run("go"))
    expect(starts).toBe(1)
    expect(ends).toEqual(["model_done", "model_done"])
  })
})

describe("Engine hooks — onError absorption", () => {
  test("onError returning handled:true converts fatal to model_done", async () => {
    const hooks: HookModule[] = [
      {
        name: "absorber",
        onError: async () => ({ handled: true }),
      },
    ]
    const script: MockScript[] = [{ kind: "error", message: "boom", status: 400 }]
    const engine = new Engine({
      model: new MockAdapter({ script }),
      tools: [],
      hooks,
      maxRetriesPerIteration: 0,
    })
    const events = await collect(engine.run("go"))
    const done = events.find((e) => e.type === "engine.done")
    if (done?.type === "engine.done") {
      expect(done.reason).toBe("model_done")
    }
    expect(events.find((e) => e.type === "engine.error")).toBeUndefined()
  })
})
