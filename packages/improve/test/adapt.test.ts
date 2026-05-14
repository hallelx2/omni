import { describe, expect, test } from "bun:test"
import { adapt } from "../src/adapt.ts"
import type { ModelProfile } from "../src/probe.ts"

const base: ModelProfile = {
  modelId: "test",
  probedAt: 0,
  nativeToolCalls: true,
  followsInstructions: true,
  verboseByDefault: false,
  averageLatencyMs: 100,
  errorRate: 0,
  notes: [],
}

describe("adapt", () => {
  test("happy path: native tools + instruction-following → base prompt", () => {
    const s = adapt(base)
    expect(s.enableReActFallback).toBe(false)
    expect(s.usePlanner).toBe(false)
    expect(s.useCritic).toBe(false)
    expect(s.systemPrompt).toContain("Omni")
  })

  test("no native tools → ReAct + fallback", () => {
    const s = adapt({ ...base, nativeToolCalls: false })
    expect(s.enableReActFallback).toBe(true)
    expect(s.systemPrompt).toContain("Action:")
    expect(s.rationale.join(" ")).toContain("nativeToolCalls=false")
  })

  test("weak instruction-following → structured prompt", () => {
    const s = adapt({ ...base, followsInstructions: false })
    expect(s.systemPrompt).toContain("Operating rules")
  })

  test("verbose → reserves more output tokens", () => {
    const s = adapt({ ...base, verboseByDefault: true })
    expect(s.reserveOutputTokens).toBeGreaterThan(4_096)
  })

  test("high error rate → enables critic and tightens iterations", () => {
    const s = adapt({ ...base, errorRate: 0.5 })
    expect(s.useCritic).toBe(true)
    expect(s.maxIterations).toBeLessThan(25)
  })

  test("instruction-poor + no tools → planner kicks in", () => {
    const s = adapt({ ...base, nativeToolCalls: false, followsInstructions: false })
    expect(s.usePlanner).toBe(true)
  })

  test("rationale explains every choice", () => {
    const s = adapt({
      ...base,
      nativeToolCalls: false,
      followsInstructions: false,
      verboseByDefault: true,
      errorRate: 0.4,
    })
    expect(s.rationale.length).toBeGreaterThanOrEqual(3)
  })
})
