import { describe, expect, test } from "bun:test"
import type { ModelCapabilities, ModelEvent } from "@omni/core"
import { withCost } from "../src/util/cost.ts"

async function* source(events: ModelEvent[]): AsyncIterable<ModelEvent> {
  for (const e of events) yield e
}

async function collect(stream: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = []
  for await (const e of stream) out.push(e)
  return out
}

describe("withCost", () => {
  test("computes USD from token usage and rates", async () => {
    const caps: ModelCapabilities = {
      contextWindow: 1000,
      supportsToolCalls: true,
      supportsStreaming: true,
      costPer1kInput: 0.001,
      costPer1kOutput: 0.003,
    }
    const events: ModelEvent[] = [
      { type: "delta", text: "hi" },
      {
        type: "done",
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      },
    ]
    const out = await collect(withCost(source(events), caps))
    const done = out.find((e) => e.type === "done")
    if (done?.type === "done") {
      // 100 * 0.001 / 1000 + 50 * 0.003 / 1000 = 0.0001 + 0.00015 = 0.00025
      expect(done.usage?.costUsd).toBeCloseTo(0.00025, 8)
    }
  })

  test("passes events through when rates not configured", async () => {
    const caps: ModelCapabilities = {
      contextWindow: 1000,
      supportsToolCalls: true,
      supportsStreaming: true,
    }
    const events: ModelEvent[] = [
      {
        type: "done",
        finishReason: "stop",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      },
    ]
    const out = await collect(withCost(source(events), caps))
    const done = out[0]
    if (done?.type === "done") {
      expect(done.usage?.costUsd).toBeUndefined()
    }
  })

  test("non-done events pass through unchanged", async () => {
    const caps: ModelCapabilities = {
      contextWindow: 1000,
      supportsToolCalls: true,
      supportsStreaming: true,
      costPer1kInput: 0.001,
      costPer1kOutput: 0.003,
    }
    const events: ModelEvent[] = [
      { type: "delta", text: "abc" },
      { type: "thinking_delta", text: "thinking" },
    ]
    const out = await collect(withCost(source(events), caps))
    expect(out).toEqual(events)
  })

  test("done without usage produces done without cost", async () => {
    const caps: ModelCapabilities = {
      contextWindow: 1000,
      supportsToolCalls: true,
      supportsStreaming: true,
      costPer1kInput: 0.001,
      costPer1kOutput: 0.003,
    }
    const events: ModelEvent[] = [{ type: "done", finishReason: "stop" }]
    const out = await collect(withCost(source(events), caps))
    if (out[0]?.type === "done") {
      expect(out[0].usage).toBeUndefined()
    }
  })
})
