import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { FileTracer, scoreTrace, readTrace } from "../src/traces.ts"
import type { EngineEvent } from "@omni/core"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omni-trace-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("FileTracer", () => {
  test("appends events as JSONL", async () => {
    const path = join(dir, "trace.jsonl")
    const tracer = new FileTracer({ path })
    tracer.record({ type: "engine.start", sessionId: "s1", input: "hi" })
    tracer.record({
      type: "engine.done",
      reason: "model_done",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, callCount: 1 },
      durationMs: 5,
    })
    await tracer.flush()
    const events = await readTrace(path)
    expect(events.length).toBe(2)
    expect(events[0]!.type).toBe("engine.start")
    expect(events[1]!.type).toBe("engine.done")
  })
})

describe("scoreTrace", () => {
  test("model_done with no errors and few iterations → high score", () => {
    const events: EngineEvent[] = [
      { type: "engine.start", sessionId: "s", input: "hi" },
      { type: "engine.iteration", iteration: 1, maxIterations: 25 },
      { type: "tool.start", call: { id: "1", name: "echo", args: {} } },
      { type: "engine.iteration", iteration: 2, maxIterations: 25 },
      { type: "tool.start", call: { id: "2", name: "glob", args: {} } },
      {
        type: "engine.done",
        reason: "model_done",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, callCount: 1 },
        durationMs: 5,
      },
    ]
    const s = scoreTrace(events)
    expect(s).toBeGreaterThanOrEqual(0.8)
  })

  test("fatal error → score 0", () => {
    const events: EngineEvent[] = [
      {
        type: "engine.error",
        error: Object.assign(new Error("x"), {
          category: "unknown" as const,
          retryable: false,
        }) as never,
        fatal: true,
      },
      {
        type: "engine.done",
        reason: "fatal_error",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 },
        durationMs: 1,
      },
    ]
    expect(scoreTrace(events)).toBe(0)
  })

  test("loop detected → reduced score", () => {
    const happy: EngineEvent[] = [
      {
        type: "engine.done",
        reason: "model_done",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 },
        durationMs: 1,
      },
    ]
    const looped: EngineEvent[] = [
      { type: "engine.loop_detected", signature: "x", occurrences: 3 },
      {
        type: "engine.done",
        reason: "loop_detected",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 },
        durationMs: 1,
      },
    ]
    expect(scoreTrace(happy)).toBeGreaterThan(scoreTrace(looped))
  })
})
