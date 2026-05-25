import { describe, expect, test } from "bun:test"
import { z } from "zod"
import {
  computeEnabledTools,
  composeSystemPrefix,
  runTurn,
  type OrchestrationDeps,
  type OrchestrationSink,
} from "../src/orchestrate.ts"
import { Engine, AllowAllPermissions, type Tool, type EngineEvent } from "@omni/core"
import { MockAdapter } from "@omni/adapters"
import type { Skill } from "@omni/improve"

const T = (name: string): Tool => ({ name, description: "", permission: "auto", schema: z.any(), execute: async () => ({}) })
const tools = [T("read_file"), T("glob"), T("grep"), T("web_fetch"), T("bash"), T("edit"), T("request_build_mode")]

describe("computeEnabledTools", () => {
  test("build + no skill → undefined (all tools)", () => {
    expect(computeEnabledTools("build", tools, null)).toBeUndefined()
  })
  test("plan + no skill → read-only ceiling", () => {
    const e = computeEnabledTools("plan", tools, null)!
    expect(e.has("read_file")).toBe(true)
    expect(e.has("bash")).toBe(false)
    expect(e.has("edit")).toBe(false)
  })
  test("build + skill → skill subset", () => {
    const skill = { toolsOnly: ["read_file", "bash"] } as unknown as Skill
    const e = computeEnabledTools("build", tools, skill)!
    expect([...e].sort()).toEqual(["bash", "read_file"])
  })
  test("plan + skill → intersection + forced escape hatch", () => {
    const skill = { toolsOnly: ["read_file", "bash"] } as unknown as Skill
    const e = computeEnabledTools("plan", tools, skill)!
    expect(e.has("read_file")).toBe(true) // in both ceiling and skill
    expect(e.has("bash")).toBe(false) // skill grants it but plan ceiling forbids
    expect(e.has("request_build_mode")).toBe(true) // always available to exit plan
  })
})

describe("composeSystemPrefix", () => {
  test("joins planner then skill; undefined when both empty", () => {
    expect(composeSystemPrefix("PLAN", "SKILL")).toBe("PLAN\n\nSKILL")
    expect(composeSystemPrefix(null, "SKILL")).toBe("SKILL")
    expect(composeSystemPrefix("PLAN", null)).toBe("PLAN")
    expect(composeSystemPrefix(null, null)).toBeUndefined()
  })
})

describe("runTurn", () => {
  const engineWith = (text: string) =>
    new Engine({ model: new MockAdapter({ script: [{ kind: "text", text }] }), tools: [], permissions: new AllowAllPermissions() })

  function makeSink() {
    const events: EngineEvent[] = []
    const plans: unknown[] = []
    const critiques: unknown[] = []
    const sink: OrchestrationSink = {
      onEngineEvent: (e) => events.push(e),
      onPlan: (p) => plans.push(p),
      onCritique: (c) => critiques.push(c),
    }
    return { events, plans, critiques, sink }
  }

  const fakePlanner = { plan: async () => ({ task: "t", steps: [{ index: 1, action: "do" }], raw: "" }) } as never
  const fakeCritic = {
    reviewMessages: async () => ({ verdict: "ok", score: 1, issues: [], raw: "" }),
    shouldRetry: () => false,
  } as never

  test("plan mode runs the planner, not the critic", async () => {
    const { plans, critiques, sink } = makeSink()
    const deps: OrchestrationDeps = { engine: engineWith("hi"), tools: [], planner: fakePlanner, critic: fakeCritic }
    await runTurn(deps, "task", { mode: "plan", activeSkill: null, strategy: null, signal: new AbortController().signal }, sink)
    expect(plans.length).toBe(1)
    expect(critiques.length).toBe(0)
  })

  test("build mode runs the critic, not the planner", async () => {
    const { plans, critiques, sink } = makeSink()
    const deps: OrchestrationDeps = { engine: engineWith("hi"), tools: [], planner: fakePlanner, critic: fakeCritic }
    await runTurn(deps, "task", { mode: "build", activeSkill: null, strategy: null, signal: new AbortController().signal }, sink)
    expect(plans.length).toBe(0)
    expect(critiques.length).toBe(1)
  })

  test("planner failure is non-fatal — the engine still runs", async () => {
    const { events, sink } = makeSink()
    const boomPlanner = { plan: async () => { throw new Error("boom") } } as never
    const deps: OrchestrationDeps = { engine: engineWith("done"), tools: [], planner: boomPlanner, critic: null }
    await runTurn(deps, "task", { mode: "plan", activeSkill: null, strategy: null, signal: new AbortController().signal }, sink)
    expect(events.some((e) => e.type === "engine.done")).toBe(true)
  })

  test("strategy.usePlanner triggers the planner even in build mode", async () => {
    const { plans, sink } = makeSink()
    const deps: OrchestrationDeps = { engine: engineWith("hi"), tools: [], planner: fakePlanner, critic: null }
    await runTurn(deps, "task", { mode: "build", activeSkill: null, strategy: { usePlanner: true, useCritic: false }, signal: new AbortController().signal }, sink)
    expect(plans.length).toBe(1)
  })

  test("plan mode blocks a mutating tool call end-to-end", async () => {
    const editTool: Tool = { name: "edit", description: "", permission: "auto", schema: z.object({ path: z.string() }), execute: async () => ({ ok: true }) }
    const engine = new Engine({
      model: new MockAdapter({ script: [{ kind: "tool", name: "edit", args: { path: "x.ts" } }, { kind: "text", text: "ok" }] }),
      tools: [editTool],
      permissions: new AllowAllPermissions(),
    })
    const { events, sink } = makeSink()
    await runTurn(
      { engine, tools: [editTool], planner: null, critic: null },
      "edit the file",
      { mode: "plan", activeSkill: null, strategy: null, signal: new AbortController().signal },
      sink,
    )
    const invalid = events.find((e) => e.type === "tool.invalid")
    expect(invalid).toBeDefined()
    if (invalid && invalid.type === "tool.invalid") expect(invalid.reason).toContain("not enabled")
  })
})
