import { describe, expect, test } from "bun:test"
import { MockAdapter } from "../../adapters/src/mock.ts"
import {
  probeModelCached,
  InMemoryProfileCache,
  type ModelProfile,
} from "../src/probe.ts"

function makeMock() {
  return new MockAdapter({
    script: [
      { kind: "text", text: "pong" },
      { kind: "tool", name: "echo", args: { text: "probe-ok" } },
      { kind: "text", text: "4" },
    ],
  })
}

describe("probeModelCached", () => {
  test("populates cache on first call", async () => {
    const cache = new InMemoryProfileCache()
    const profile = await probeModelCached(makeMock(), cache)
    expect(profile.modelId).toBe("mock-1")
    const cached = await cache.get("mock-1")
    expect(cached?.modelId).toBe("mock-1")
  })

  test("returns cached profile on second call (no re-probe)", async () => {
    const cache = new InMemoryProfileCache()
    const model1 = makeMock()
    const p1 = await probeModelCached(model1, cache)
    // Reset the mock — if probeModelCached re-runs, it'll find different script state.
    const model2 = makeMock()
    const p2 = await probeModelCached(model2, cache)
    expect(p2.probedAt).toBe(p1.probedAt) // same record returned
  })

  test("re-probes when cached profile is older than maxAgeMs", async () => {
    const cache = new InMemoryProfileCache()
    const stale: ModelProfile = {
      modelId: "mock-1",
      probedAt: Date.now() - 60_000,
      nativeToolCalls: false,
      followsInstructions: false,
      verboseByDefault: false,
      averageLatencyMs: 0,
      errorRate: 0,
      notes: ["stale"],
    }
    await cache.set(stale)
    const fresh = await probeModelCached(makeMock(), cache, { maxAgeMs: 1_000 })
    expect(fresh.probedAt).toBeGreaterThan(stale.probedAt)
    expect(fresh.followsInstructions).toBe(true) // mock would pass instruction probe
  })

  test("custom cache backend", async () => {
    const calls: { get: number; set: number } = { get: 0, set: 0 }
    const cache = {
      get(_id: string) {
        calls.get++
        return null
      },
      set(_p: ModelProfile) {
        calls.set++
      },
    }
    await probeModelCached(makeMock(), cache)
    expect(calls.get).toBe(1)
    expect(calls.set).toBe(1)
  })
})
