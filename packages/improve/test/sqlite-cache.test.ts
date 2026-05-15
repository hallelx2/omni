import { describe, expect, test } from "bun:test"
import { Storage, ProfilesRepo } from "@omni/storage"
import { SqliteProfileCache } from "../src/sqlite-cache.ts"
import { probeModelCached, type ModelProfile } from "../src/probe.ts"
import { MockAdapter } from "../../adapters/src/mock.ts"

function makeStore() {
  return new Storage(":memory:")
}

function makeMock() {
  return new MockAdapter({
    script: [
      { kind: "text", text: "pong" },
      { kind: "tool", name: "echo", args: { text: "probe-ok" } },
      { kind: "text", text: "4" },
    ],
  })
}

describe("SqliteProfileCache", () => {
  test("round-trip a profile", () => {
    const store = makeStore()
    const cache = new SqliteProfileCache(new ProfilesRepo(store))
    const profile: ModelProfile = {
      modelId: "test-model",
      probedAt: 1000,
      nativeToolCalls: true,
      followsInstructions: true,
      verboseByDefault: false,
      averageLatencyMs: 50,
      errorRate: 0,
      notes: ["all good"],
    }
    cache.set(profile)
    expect(cache.get("test-model")).toEqual(profile)
    store.close()
  })

  test("returns null for missing model", () => {
    const store = makeStore()
    const cache = new SqliteProfileCache(new ProfilesRepo(store))
    expect(cache.get("nope")).toBeNull()
    store.close()
  })

  test("upsert overwrites prior profile", () => {
    const store = makeStore()
    const cache = new SqliteProfileCache(new ProfilesRepo(store))
    cache.set({
      modelId: "m",
      probedAt: 1,
      nativeToolCalls: false,
      followsInstructions: false,
      verboseByDefault: false,
      averageLatencyMs: 0,
      errorRate: 0,
      notes: [],
    })
    cache.set({
      modelId: "m",
      probedAt: 2,
      nativeToolCalls: true,
      followsInstructions: true,
      verboseByDefault: false,
      averageLatencyMs: 0,
      errorRate: 0,
      notes: [],
    })
    expect(cache.get("m")?.nativeToolCalls).toBe(true)
    store.close()
  })

  test("works as drop-in for probeModelCached", async () => {
    const store = makeStore()
    const cache = new SqliteProfileCache(new ProfilesRepo(store))
    const model = makeMock()
    const profile = await probeModelCached(model, cache)
    expect(profile.modelId).toBe("mock-1")
    expect(cache.get("mock-1")?.modelId).toBe("mock-1")
    store.close()
  })

  test("second call uses cached profile (no re-probe)", async () => {
    const store = makeStore()
    const cache = new SqliteProfileCache(new ProfilesRepo(store))
    const first = await probeModelCached(makeMock(), cache)
    const second = await probeModelCached(makeMock(), cache)
    expect(second.probedAt).toBe(first.probedAt)
  })
})
