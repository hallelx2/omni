import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { FileTracer } from "../src/traces.ts"
import { replayTrace, checkTrace } from "../src/replay.ts"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omni-replay-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function writeSampleTrace(path: string): Promise<void> {
  const t = new FileTracer({ path })
  t.record({ type: "engine.start", sessionId: "s", input: "hi" })
  t.record({ type: "engine.iteration", iteration: 1, maxIterations: 5 })
  t.record({ type: "model.delta", text: "ok" })
  t.record({
    type: "engine.done",
    reason: "model_done",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, callCount: 1 },
    durationMs: 5,
  })
  await t.flush()
}

describe("replayTrace", () => {
  test("yields events in recorded order", async () => {
    const path = join(dir, "trace.jsonl")
    await writeSampleTrace(path)
    const out: string[] = []
    for await (const e of replayTrace(path)) out.push(e.type)
    expect(out).toEqual([
      "engine.start",
      "engine.iteration",
      "model.delta",
      "engine.done",
    ])
  })
})

describe("checkTrace", () => {
  test("passes when all checks are satisfied", async () => {
    const path = join(dir, "trace.jsonl")
    await writeSampleTrace(path)
    const v = await checkTrace(path, {
      mustContainTypes: ["engine.start", "engine.done"],
      mustEndWith: "engine.done",
      maxIterations: 5,
      maxErrors: 0,
    })
    expect(v).toEqual([])
  })

  test("flags missing event type", async () => {
    const path = join(dir, "trace.jsonl")
    await writeSampleTrace(path)
    const v = await checkTrace(path, { mustContainTypes: ["tool.result"] })
    expect(v.length).toBe(1)
    expect(v[0]!).toContain("tool.result")
  })

  test("flags wrong terminal event", async () => {
    const path = join(dir, "trace.jsonl")
    await writeSampleTrace(path)
    const v = await checkTrace(path, { mustEndWith: "engine.error" })
    expect(v.length).toBe(1)
    expect(v[0]!).toContain("expected last event")
  })

  test("flags exceeded iteration budget", async () => {
    const path = join(dir, "trace.jsonl")
    await writeSampleTrace(path)
    const v = await checkTrace(path, { maxIterations: 0 })
    expect(v.length).toBe(1)
    expect(v[0]!).toContain("too many iterations")
  })
})
