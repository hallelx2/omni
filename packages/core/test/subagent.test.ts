import { describe, expect, test } from "bun:test"
import { z } from "zod"
import {
  Engine,
  AllowAllPermissions,
  DenyAllPermissions,
  asSubagent,
  type EngineEvent,
  type Tool,
  type ToolContext,
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

function makeChild(script: MockScript[]): Engine {
  return new Engine({
    model: new MockAdapter({ script }),
    tools: [makeEcho()],
    permissions: new AllowAllPermissions(),
  })
}

describe("asSubagent", () => {
  test("delegates a task and returns the child's final text", async () => {
    const child = makeChild([
      { kind: "tool", name: "echo", args: { text: "hi" } },
      { kind: "text", text: "the answer is hi" },
    ])
    const tool = asSubagent(child, {
      name: "delegate",
      description: "delegate a task",
      permission: "auto",
    })
    const ctx: ToolContext = {
      cwd: process.cwd(),
      signal: new AbortController().signal,
    }
    const result = await tool.execute({ task: "say hi" }, ctx)
    expect(result.result).toBe("the answer is hi")
    expect(result.iterations).toBeGreaterThan(0)
    expect(result.reason).toBe("model_done")
    expect(result.tokensUsed).toBeGreaterThan(0)
  })

  test("emits progress to parent ctx.onProgress", async () => {
    const child = makeChild([{ kind: "text", text: "done quickly" }])
    const tool = asSubagent(child, {
      name: "delegate",
      description: "delegate a task",
      permission: "auto",
    })
    const progress: string[] = []
    const ctx: ToolContext = {
      cwd: process.cwd(),
      signal: new AbortController().signal,
      onProgress: (m) => progress.push(m),
    }
    await tool.execute({ task: "x" }, ctx)
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.some((p) => p.startsWith("iter"))).toBe(true)
  })

  test("custom decorator filters which child events surface", async () => {
    const child = makeChild([{ kind: "text", text: "done" }])
    const tool = asSubagent(child, {
      name: "delegate",
      description: "",
      permission: "auto",
      onChildEvent: (ev, emit) => {
        if (ev.type === "engine.done") emit("FINAL")
      },
    })
    const progress: string[] = []
    const ctx: ToolContext = {
      cwd: process.cwd(),
      signal: new AbortController().signal,
      onProgress: (m) => progress.push(m),
    }
    await tool.execute({ task: "x" }, ctx)
    expect(progress).toEqual(["FINAL"])
  })

  test("composes with parent engine — parent calls subagent as a tool", async () => {
    const child = makeChild([{ kind: "text", text: "child says hello" }])
    const subagent = asSubagent(child, {
      name: "delegate",
      description: "delegate a task to the executor",
      permission: "auto",
    })
    const parent = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "delegate", args: { task: "say hello" } },
          { kind: "text", text: "the child reported back" },
        ],
      }),
      tools: [subagent],
      permissions: new AllowAllPermissions(),
    })
    const events = await collect(parent.run("plan it"))
    const result = events.find((e) => e.type === "tool.result")
    if (result?.type === "tool.result") {
      const r = result.result as { result: string }
      expect(r.result).toBe("child says hello")
    } else {
      throw new Error("expected tool.result from delegate")
    }
  })

  test("aborts the child when the parent's signal fires", async () => {
    const slowEcho: Tool<{ text: string }, { text: string }> = {
      name: "slow",
      description: "",
      permission: "auto",
      schema: z.object({ text: z.string() }),
      async execute(args, ctx: ToolContext) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 5_000)
          ctx.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(t)
              reject(new DOMException("Aborted", "AbortError"))
            },
            { once: true },
          )
        })
        return { text: args.text }
      },
    }
    const child = new Engine({
      model: new MockAdapter({ script: [{ kind: "tool", name: "slow", args: { text: "x" } }] }),
      tools: [slowEcho],
      permissions: new AllowAllPermissions(),
    })
    const tool = asSubagent(child, {
      name: "delegate",
      description: "",
      permission: "auto",
    })
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 50)
    const ctx: ToolContext = { cwd: process.cwd(), signal: ac.signal }
    const result = await tool.execute({ task: "x" }, ctx)
    // Aborted runs still return — they just don't carry useful text.
    expect(result.reason).toBe("aborted")
  })

  test("history=isolate (default) clears non-system messages between calls", async () => {
    const child = makeChild([
      { kind: "text", text: "reply 1" },
      { kind: "text", text: "reply 2" },
    ])
    const tool = asSubagent(child, {
      name: "delegate",
      description: "",
      permission: "auto",
    })
    const ctx: ToolContext = { cwd: process.cwd(), signal: new AbortController().signal }
    await tool.execute({ task: "first" }, ctx)
    const afterFirst = child.history().filter((m) => m.role !== "system").length
    await tool.execute({ task: "second" }, ctx)
    const afterSecond = child.history().filter((m) => m.role !== "system").length
    // Both runs add the same number of non-system messages because the second
    // run starts isolated (history cleared) rather than appended.
    expect(afterSecond).toBe(afterFirst)
  })

  test("history=keep preserves prior turns across calls", async () => {
    const child = makeChild([
      { kind: "text", text: "reply 1" },
      { kind: "text", text: "reply 2" },
    ])
    const tool = asSubagent(child, {
      name: "delegate",
      description: "",
      permission: "auto",
      history: "keep",
    })
    const ctx: ToolContext = { cwd: process.cwd(), signal: new AbortController().signal }
    await tool.execute({ task: "first" }, ctx)
    const afterFirst = child.history().filter((m) => m.role !== "system").length
    await tool.execute({ task: "second" }, ctx)
    const afterSecond = child.history().filter((m) => m.role !== "system").length
    expect(afterSecond).toBeGreaterThan(afterFirst)
  })

  test("history={keepLast:N} truncates to N prior non-system messages", async () => {
    const child = makeChild([
      { kind: "text", text: "reply 1" },
      { kind: "text", text: "reply 2" },
      { kind: "text", text: "reply 3" },
    ])
    const tool = asSubagent(child, {
      name: "delegate",
      description: "",
      permission: "auto",
      history: { keepLast: 1 },
    })
    const ctx: ToolContext = { cwd: process.cwd(), signal: new AbortController().signal }
    await tool.execute({ task: "first" }, ctx)
    await tool.execute({ task: "second" }, ctx)
    // After second call: child kept at most 1 prior non-system msg + this run's
    // (user + assistant) turn. So total non-system = 1 + 2 = 3.
    const after = child.history().filter((m) => m.role !== "system").length
    expect(after).toBeLessThanOrEqual(3)
  })

  test("respects child's permission gate (parent grant doesn't override)", async () => {
    const child = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "echo", args: { text: "should be denied" } },
          { kind: "text", text: "i was blocked" },
        ],
      }),
      tools: [makeEcho()],
      permissions: new DenyAllPermissions(),
    })
    const tool = asSubagent(child, {
      name: "delegate",
      description: "",
      permission: "auto",
    })
    const ctx: ToolContext = { cwd: process.cwd(), signal: new AbortController().signal }
    const result = await tool.execute({ task: "x" }, ctx)
    // Child still produces a final message even when its tool was denied
    expect(result.result).toBe("i was blocked")
  })
})
