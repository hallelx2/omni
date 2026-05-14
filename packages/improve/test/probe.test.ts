import { describe, expect, test } from "bun:test"
import { MockAdapter } from "../../adapters/src/mock.ts"
import { probeModel } from "../src/probe.ts"

describe("probeModel", () => {
  test("flags followsInstructions=true on exact reply", async () => {
    const model = new MockAdapter({
      script: [
        { kind: "text", text: "pong" },
        { kind: "tool", name: "echo", args: { text: "probe-ok" } },
        { kind: "text", text: "4" },
      ],
    })
    const profile = await probeModel(model)
    expect(profile.followsInstructions).toBe(true)
    expect(profile.nativeToolCalls).toBe(true)
    expect(profile.modelId).toBe("mock-1")
    expect(profile.notes.length).toBeGreaterThanOrEqual(3)
  })

  test("flags followsInstructions=false on verbose reply", async () => {
    const model = new MockAdapter({
      script: [
        { kind: "text", text: "Sure! Here's the response: pong (which is a pingback to your test)" },
        { kind: "tool", name: "echo", args: { text: "probe-ok" } },
        { kind: "text", text: "The answer is four (4)" },
      ],
    })
    const profile = await probeModel(model)
    expect(profile.followsInstructions).toBe(false)
    expect(profile.verboseByDefault).toBe(true)
  })

  test("flags nativeToolCalls=false on missing tool call", async () => {
    const model = new MockAdapter({
      script: [
        { kind: "text", text: "pong" },
        { kind: "text", text: "I would call echo here but won't." },
        { kind: "text", text: "4" },
      ],
    })
    const profile = await probeModel(model)
    expect(profile.nativeToolCalls).toBe(false)
  })

  test("records error rate when a probe throws", async () => {
    const model = new MockAdapter({
      script: [
        { kind: "error", message: "boom" },
        { kind: "tool", name: "echo", args: { text: "probe-ok" } },
        { kind: "text", text: "4" },
      ],
    })
    const profile = await probeModel(model)
    expect(profile.errorRate).toBeGreaterThan(0)
  })

  test("skipTools omits the tool-calling probe", async () => {
    const model = new MockAdapter({
      script: [
        { kind: "text", text: "pong" },
        { kind: "text", text: "4" },
      ],
    })
    const profile = await probeModel(model, { skipTools: true })
    expect(profile.notes.find((n) => n.includes("Probe 2"))).toBeUndefined()
  })
})
