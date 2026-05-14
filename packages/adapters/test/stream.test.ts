import { describe, expect, test } from "bun:test"
import type { ModelEvent } from "@omni/core"
import { translateStream } from "../src/util/stream.ts"

// Helpers for fabricating AI SDK TextStreamPart events. We're testing our
// translation layer in isolation — no AI SDK call needed.
type AnyPart = Record<string, unknown> & { type: string }

async function* arr(parts: AnyPart[]): AsyncIterable<AnyPart> {
  for (const p of parts) yield p
}

async function collect(stream: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = []
  for await (const e of stream) out.push(e)
  return out
}

describe("translateStream", () => {
  test("text-delta → delta", async () => {
    const parts: AnyPart[] = [
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", text: "Hello" },
      { type: "text-delta", id: "t1", text: " world" },
      { type: "text-end", id: "t1" },
      {
        type: "finish",
        finishReason: "stop",
        totalUsage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 },
      },
    ]
    const events = await collect(translateStream(arr(parts) as never))
    expect(events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text)).toEqual([
      "Hello",
      " world",
    ])
    const done = events.find((e) => e.type === "done")
    expect(done?.type).toBe("done")
    if (done?.type === "done") {
      expect(done.finishReason).toBe("stop")
      expect(done.usage?.totalTokens).toBe(7)
    }
  })

  test("reasoning-delta → thinking_delta", async () => {
    const parts: AnyPart[] = [
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", text: "let me think..." },
      { type: "reasoning-end", id: "r1" },
      { type: "finish", finishReason: "stop", totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
    ]
    const events = await collect(translateStream(arr(parts) as never))
    const thinking = events.filter((e) => e.type === "thinking_delta")
    expect(thinking).toHaveLength(1)
    expect((thinking[0]! as { text: string }).text).toBe("let me think...")
  })

  test("tool-input-start → tool_call_start, then tool-call → tool_call", async () => {
    const parts: AnyPart[] = [
      { type: "tool-input-start", id: "c1", toolName: "echo" },
      { type: "tool-input-delta", id: "c1", delta: '{"text":' },
      { type: "tool-input-delta", id: "c1", delta: '"hi"}' },
      { type: "tool-input-end", id: "c1" },
      { type: "tool-call", toolCallId: "c1", toolName: "echo", input: { text: "hi" } },
      { type: "finish", finishReason: "tool-calls", totalUsage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 } },
    ]
    const events = await collect(translateStream(arr(parts) as never))
    const starts = events.filter((e) => e.type === "tool_call_start")
    const deltas = events.filter((e) => e.type === "tool_call_args_delta")
    const finals = events.filter((e) => e.type === "tool_call")
    expect(starts).toHaveLength(1)
    expect(deltas).toHaveLength(2)
    expect(finals).toHaveLength(1)
    const finalCall = (finals[0]! as { call: { id: string; name: string; args: unknown } }).call
    expect(finalCall.id).toBe("c1")
    expect(finalCall.name).toBe("echo")
    expect(finalCall.args).toEqual({ text: "hi" })
    const done = events.find((e) => e.type === "done")
    if (done?.type === "done") expect(done.finishReason).toBe("tool_calls")
  })

  test("error event becomes ModelEvent.error", async () => {
    const parts: AnyPart[] = [
      { type: "text-delta", id: "t1", text: "partial" },
      { type: "error", error: new Error("provider failed") },
    ]
    const events = await collect(translateStream(arr(parts) as never))
    const err = events.find((e) => e.type === "error")
    expect(err?.type).toBe("error")
    if (err?.type === "error") {
      expect(err.error.message).toBe("provider failed")
    }
  })

  test("error event with string error wraps it", async () => {
    const parts: AnyPart[] = [{ type: "error", error: "string-only" }]
    const events = await collect(translateStream(arr(parts) as never))
    const err = events.find((e) => e.type === "error")
    if (err?.type === "error") {
      expect(err.error.message).toBe("string-only")
    }
  })

  test("abort event surfaces as error with AbortError name", async () => {
    const parts: AnyPart[] = [{ type: "abort", reason: "user requested" }]
    const events = await collect(translateStream(arr(parts) as never))
    const err = events.find((e) => e.type === "error")
    if (err?.type === "error") {
      expect(err.error.name).toBe("AbortError")
    }
  })

  test("ignored events do not emit", async () => {
    const parts: AnyPart[] = [
      { type: "start" },
      { type: "start-step", request: {}, warnings: [] },
      { type: "text-start", id: "t1" },
      { type: "text-end", id: "t1" },
      { type: "finish-step", response: {}, usage: {}, finishReason: "stop" },
      { type: "finish", finishReason: "stop", totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
    ]
    const events = await collect(translateStream(arr(parts) as never))
    // Only the finish should produce an event.
    expect(events).toHaveLength(1)
    expect(events[0]!.type).toBe("done")
  })

  test("finishReason mapping covers all known values", async () => {
    const reasons: Array<[string, string]> = [
      ["stop", "stop"],
      ["length", "length"],
      ["tool-calls", "tool_calls"],
      ["content-filter", "content_filter"],
      ["error", "error"],
      ["other", "unknown"],
    ]
    for (const [aiSdk, omni] of reasons) {
      const parts: AnyPart[] = [
        { type: "finish", finishReason: aiSdk, totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } },
      ]
      const events = await collect(translateStream(arr(parts) as never))
      const done = events[0]
      if (done?.type === "done") {
        expect(done.finishReason).toBe(omni as never)
      }
    }
  })
})
