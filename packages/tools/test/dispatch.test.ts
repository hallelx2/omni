import { describe, expect, test } from "bun:test"
import { z } from "zod"
import {
  Engine,
  AllowAllPermissions,
  asSubagent,
  type Tool,
  type ToolContext,
  type SubagentResult,
} from "@omni/core"
import { MockAdapter } from "../../adapters/src/mock.ts"
import { makeDispatchAgentsTool, PER_CHILD_RESULT_BYTES } from "../src/dispatch.ts"

const ctx = (signal: AbortSignal): ToolContext => ({ cwd: process.cwd(), signal })
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** An agent tool backed by a real child engine that just emits final text. */
function textAgent(name: string, finalText: string): Tool<{ task: string }, SubagentResult> {
  const engine = new Engine({
    model: new MockAdapter({ script: [{ kind: "text", text: finalText }] }),
    tools: [],
    permissions: new AllowAllPermissions(),
  })
  return asSubagent(engine, { name, description: "", permission: "auto" })
}

describe("dispatch_agents", () => {
  test("runs agents in parallel and aggregates results", async () => {
    const tools = new Map([
      ["alpha", textAgent("alpha", "A done")],
      ["beta", textAgent("beta", "B done")],
    ])
    const dispatch = makeDispatchAgentsTool({
      getAgentTool: (n) => tools.get(n),
      listAgents: () => [...tools.keys()],
    })
    const r = await dispatch.execute(
      { tasks: [{ agent: "alpha", task: "x" }, { agent: "beta", task: "y" }] },
      ctx(new AbortController().signal),
    )
    expect(r.dispatched).toBe(2)
    expect(r.succeeded).toBe(2)
    expect(r.failed).toBe(0)
    expect(r.results.map((x) => x.result).sort()).toEqual(["A done", "B done"])
    expect(r.totalTokensUsed).toBeGreaterThan(0)
  })

  test("unknown agent → ok:false item, never throws", async () => {
    const tools = new Map([["alpha", textAgent("alpha", "A")]])
    const dispatch = makeDispatchAgentsTool({ getAgentTool: (n) => tools.get(n), listAgents: () => [...tools.keys()] })
    const r = await dispatch.execute({ tasks: [{ agent: "ghost", task: "x" }] }, ctx(new AbortController().signal))
    expect(r.failed).toBe(1)
    expect(r.results[0]!.ok).toBe(false)
    expect(r.results[0]!.error).toContain("unknown agent")
  })

  test("one failing agent does not sink the others", async () => {
    const boom: Tool<{ task: string }, SubagentResult> = {
      name: "boom",
      description: "",
      permission: "auto",
      schema: z.object({ task: z.string() }),
      async execute() {
        throw new Error("kaboom")
      },
    }
    const tools = new Map<string, Tool<{ task: string }, SubagentResult>>([
      ["alpha", textAgent("alpha", "A done")],
      ["boom", boom],
    ])
    const dispatch = makeDispatchAgentsTool({ getAgentTool: (n) => tools.get(n), listAgents: () => [...tools.keys()] })
    const r = await dispatch.execute(
      { tasks: [{ agent: "alpha", task: "x" }, { agent: "boom", task: "y" }] },
      ctx(new AbortController().signal),
    )
    expect(r.succeeded).toBe(1)
    expect(r.failed).toBe(1)
    expect(r.results.find((x) => x.agent === "boom")!.error).toContain("kaboom")
  })

  test("aborting the parent cancels children (reason aborted)", async () => {
    const waitTool: Tool = {
      name: "wait",
      description: "",
      permission: "auto",
      schema: z.object({}),
      async execute(_a, c: ToolContext) {
        await new Promise<void>((res, rej) => {
          const t = setTimeout(res, 5_000)
          c.signal.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("Aborted", "AbortError")) }, { once: true })
        })
        return {}
      },
    }
    const slowAgent = (name: string): Tool<{ task: string }, SubagentResult> => {
      const engine = new Engine({
        model: new MockAdapter({ script: [{ kind: "tool", name: "wait", args: {} }] }),
        tools: [waitTool],
        permissions: new AllowAllPermissions(),
      })
      return asSubagent(engine, { name, description: "", permission: "auto" })
    }
    const tools = new Map([["slow", slowAgent("slow")]])
    const dispatch = makeDispatchAgentsTool({ getAgentTool: (n) => tools.get(n), listAgents: () => [...tools.keys()] })
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 50)
    const start = Date.now()
    const r = await dispatch.execute({ tasks: [{ agent: "slow", task: "x" }] }, ctx(ac.signal))
    expect(Date.now() - start).toBeLessThan(4_000)
    expect(r.aborted).toBe(true)
    expect(r.results[0]!.reason).toBe("aborted")
  })

  test("respects max_concurrency", async () => {
    let active = 0
    let peak = 0
    const counting = (name: string): Tool<{ task: string }, SubagentResult> => ({
      name,
      description: "",
      permission: "auto",
      schema: z.object({ task: z.string() }),
      async execute() {
        active++
        peak = Math.max(peak, active)
        await sleep(30)
        active--
        return { result: name, iterations: 1, reason: "model_done", tokensUsed: 1 }
      },
    })
    const tools = new Map([
      ["a", counting("a")],
      ["b", counting("b")],
      ["c", counting("c")],
      ["d", counting("d")],
    ])
    const dispatch = makeDispatchAgentsTool({ getAgentTool: (n) => tools.get(n), listAgents: () => [...tools.keys()] })
    const r = await dispatch.execute(
      {
        tasks: [
          { agent: "a", task: "1" },
          { agent: "b", task: "2" },
          { agent: "c", task: "3" },
          { agent: "d", task: "4" },
        ],
        max_concurrency: 2,
      },
      ctx(new AbortController().signal),
    )
    expect(r.succeeded).toBe(4)
    expect(peak).toBeLessThanOrEqual(2)
  })

  test("a parent engine can call dispatch_agents and receive aggregated results", async () => {
    const agents = new Map([
      ["alpha", textAgent("alpha", "A done")],
      ["beta", textAgent("beta", "B done")],
    ])
    const dispatch = makeDispatchAgentsTool({ getAgentTool: (n) => agents.get(n), listAgents: () => [...agents.keys()] })
    const parent = new Engine({
      model: new MockAdapter({
        script: [
          { kind: "tool", name: "dispatch_agents", args: { tasks: [{ agent: "alpha", task: "x" }, { agent: "beta", task: "y" }] } },
          { kind: "text", text: "both done" },
        ],
      }),
      tools: [dispatch],
      permissions: new AllowAllPermissions(),
    })
    const events: { type: string; result?: unknown }[] = []
    for await (const ev of parent.run("do both")) events.push(ev)
    const result = events.find((e) => e.type === "tool.result")
    expect(result).toBeDefined()
    const r = result!.result as { dispatched: number; succeeded: number }
    expect(r.dispatched).toBe(2)
    expect(r.succeeded).toBe(2)
  })

  test("truncates oversized child results", async () => {
    const big = "x".repeat(PER_CHILD_RESULT_BYTES + 5_000)
    const tools = new Map([["alpha", textAgent("alpha", big)]])
    const dispatch = makeDispatchAgentsTool({ getAgentTool: (n) => tools.get(n), listAgents: () => [...tools.keys()] })
    const r = await dispatch.execute({ tasks: [{ agent: "alpha", task: "x" }] }, ctx(new AbortController().signal))
    expect(r.results[0]!.truncated).toBe(true)
    expect(r.results[0]!.result.length).toBeLessThan(PER_CHILD_RESULT_BYTES + 200)
  })
})
