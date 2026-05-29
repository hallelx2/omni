import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { resolveAdapter, buildAgentEngine, makeAgentTool, structuredConfigFor, composeAgentSystemPrompt } from "../src/agents-runtime.ts"
import { MockAdapter } from "@omni/adapters"
import type { Config, ModelAdapter, Tool, ToolContext } from "@omni/core"
import type { Agent, Skill } from "@omni/improve"

const fallback: ModelAdapter = new MockAdapter({ id: "fallback", script: [{ kind: "text", text: "fb" }] })
const emptyConfig = {} as Config

describe("resolveAdapter", () => {
  test("empty / undefined ref → fallback", () => {
    expect(resolveAdapter(undefined, { config: emptyConfig, fallback }).id).toBe("fallback")
    expect(resolveAdapter("", { config: emptyConfig, fallback }).id).toBe("fallback")
  })

  test("explicit mock provider → fallback", () => {
    expect(resolveAdapter("mock:any", { config: emptyConfig, fallback }).id).toBe("fallback")
  })

  test("missing provider key → fallback + warning (never throws)", () => {
    if (process.env.ANTHROPIC_API_KEY) return // skip when a real key is present
    const warns: string[] = []
    const a = resolveAdapter("anthropic:claude-haiku-4-5", { config: emptyConfig, fallback, warn: (m) => warns.push(m) })
    expect(a.id).toBe("fallback")
    expect(warns.length).toBe(1)
  })

  test("caches by ref", () => {
    const cache = new Map<string, ModelAdapter>()
    const a1 = resolveAdapter("some-model", { config: emptyConfig, fallback, cache })
    const a2 = resolveAdapter("some-model", { config: emptyConfig, fallback, cache })
    expect(a1).toBe(a2)
  })
})

describe("structuredConfigFor", () => {
  const withLM = {
    id: "lm",
    name: "lm",
    capabilities: { contextWindow: 1000, supportsToolCalls: true, supportsStreaming: true },
    async *complete() {},
    languageModel: () => ({ tag: "lm" }),
  } as unknown as ModelAdapter
  const noLM = new MockAdapter({ script: [] })

  test("no languageModel → text mode", () => {
    expect(structuredConfigFor(noLM, { isMain: true, mainSupportsStructured: true }).useStructuredOutput).toBe(false)
  })
  test("per-role override with a languageModel → structured", () => {
    const r = structuredConfigFor(withLM, { isMain: false })
    expect(r.useStructuredOutput).toBe(true)
    expect(r.languageModel).toBeDefined()
  })
  test("main model is gated on the probe result", () => {
    expect(structuredConfigFor(withLM, { isMain: true, mainSupportsStructured: true }).useStructuredOutput).toBe(true)
    expect(structuredConfigFor(withLM, { isMain: true, mainSupportsStructured: false }).useStructuredOutput).toBe(false)
  })
  test("main model with no probe info defaults to enabled (fallback covers misses)", () => {
    expect(structuredConfigFor(withLM, { isMain: true }).useStructuredOutput).toBe(true)
  })
})

describe("buildAgentEngine / makeAgentTool", () => {
  const agent: Agent = {
    name: "explore",
    description: "investigator",
    systemPrompt: "be terse",
    source: "default",
    path: "",
    tools: ["read_file"],
    permissionDefault: "deny",
  }
  const baseTools: Tool[] = [
    { name: "read_file", description: "", permission: "auto", schema: z.any(), execute: async () => ({ ok: true }) },
    { name: "bash", description: "", permission: "auto", schema: z.any(), execute: async () => ({ ok: true }) },
  ]
  const deps = {
    tools: baseTools,
    config: emptyConfig,
    resolveModel: () => new MockAdapter({ script: [{ kind: "text", text: "done" }] }),
  }

  test("buildAgentEngine returns a usable engine", () => {
    expect(buildAgentEngine(agent, deps)).toBeDefined()
  })

  test("makeAgentTool runs a fresh child engine and returns its final text", async () => {
    const tool = makeAgentTool(agent, deps)
    const ctx: ToolContext = { cwd: process.cwd(), signal: new AbortController().signal }
    const r = await tool.execute({ task: "go" }, ctx)
    expect(r.result).toBe("done")
    expect(r.reason).toBe("model_done")
  })

  test("concurrent same-agent calls are isolated", async () => {
    const tool = makeAgentTool(agent, deps)
    const ctx: ToolContext = { cwd: process.cwd(), signal: new AbortController().signal }
    const [a, b] = await Promise.all([tool.execute({ task: "1" }, ctx), tool.execute({ task: "2" }, ctx)])
    expect(a.result).toBe("done")
    expect(b.result).toBe("done")
  })

  test("composeAgentSystemPrompt injects attached skills (and honors 'none')", () => {
    const skill: Skill = {
      name: "demo",
      description: "demo skill",
      triggers: [],
      systemPrompt: "DEMOBODY",
      source: "user",
      path: "",
    }
    const skills = new Map<string, Skill>([["demo", skill]])
    const withSkill: Agent = { ...agent, skills: ["demo"] }

    const out = composeAgentSystemPrompt(withSkill, { ...deps, skills })
    expect(out).toContain("be terse") // the agent body
    expect(out).toContain("## Skill: demo")
    expect(out).toContain("DEMOBODY")
    expect(out.indexOf("be terse")).toBeLessThan(out.indexOf("## Skill: demo"))

    // missing skill → body only, no throw
    const miss = composeAgentSystemPrompt({ ...agent, skills: ["nope"] }, { ...deps, skills })
    expect(miss).toBe("be terse")

    // skillResources "none" suppresses injection
    const none = composeAgentSystemPrompt({ ...withSkill, skillResources: "none" }, { ...deps, skills })
    expect(none).toBe("be terse")
  })

  test("streams a clean child-activity trace via onProgress (no model.delta spam)", async () => {
    const progAgent: Agent = {
      name: "prog",
      description: "",
      systemPrompt: "",
      source: "default",
      path: "",
      tools: ["read_file"],
      permissionDefault: "deny",
    }
    const baseTools2: Tool[] = [
      { name: "read_file", description: "", permission: "auto", schema: z.any(), execute: async () => ({ ok: true }) },
    ]
    const progDeps = {
      tools: baseTools2,
      config: emptyConfig,
      resolveModel: () =>
        new MockAdapter({ script: [{ kind: "tool", name: "read_file", args: { path: "x" } }, { kind: "text", text: "done" }] }),
    }
    const tool = makeAgentTool(progAgent, progDeps)
    const lines: string[] = []
    const ctx: ToolContext = { cwd: process.cwd(), signal: new AbortController().signal, onProgress: (m) => lines.push(m) }
    await tool.execute({ task: "go" }, ctx)
    expect(lines.some((l) => l.startsWith("→ read_file"))).toBe(true)
    expect(lines.some((l) => l.startsWith("iter "))).toBe(true)
    expect(lines.some((l) => l.startsWith("…"))).toBe(false)
  })
})
