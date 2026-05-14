import { describe, expect, test } from "bun:test"
import { renderEvent } from "../src/render.ts"
import type { EngineEvent } from "@omni/core"

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "")
}

describe("renderEvent", () => {
  test("engine.start produces no visible output", () => {
    expect(renderEvent({ type: "engine.start", sessionId: "s", input: "hi" })).toBe("")
  })

  test("engine.iteration shows iter counter", () => {
    const out = stripAnsi(
      renderEvent({ type: "engine.iteration", iteration: 2, maxIterations: 10 }),
    )
    expect(out).toContain("[iter 2/10]")
  })

  test("model.delta passes through text", () => {
    expect(renderEvent({ type: "model.delta", text: "hello" })).toBe("hello")
  })

  test("tool.result shows duration and preview", () => {
    const out = stripAnsi(
      renderEvent({
        type: "tool.result",
        call: { id: "1", name: "echo", args: {} },
        result: "ok",
        durationMs: 42,
      }),
    )
    expect(out).toContain("42ms")
    expect(out).toContain("ok")
  })

  test("tool.error includes category", () => {
    const out = stripAnsi(
      renderEvent({
        type: "tool.error",
        call: { id: "1", name: "bash", args: {} },
        error: Object.assign(new Error("oops"), {
          category: "tool_failure" as const,
          retryable: false,
        }) as never,
        durationMs: 5,
      }),
    )
    expect(out).toContain("oops")
    expect(out).toContain("tool_failure")
  })

  test("engine.done shows reason and totals", () => {
    const out = stripAnsi(
      renderEvent({
        type: "engine.done",
        reason: "model_done",
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          callCount: 1,
          costUsd: 0.001,
        },
        durationMs: 1234,
      }),
    )
    expect(out).toContain("done")
    expect(out).toContain("1234ms")
    expect(out).toContain("15 tokens")
    expect(out).toContain("$0.0010")
  })

  test("tool.permission_requested suppressed for auto permission", () => {
    const ev: EngineEvent = {
      type: "tool.permission_requested",
      call: { id: "1", name: "read_file", args: {} },
      tool: { name: "read_file", description: "", permission: "auto" },
    }
    expect(renderEvent(ev)).toBe("")
  })

  test("tool.permission_requested shown for ask permission", () => {
    const out = stripAnsi(
      renderEvent({
        type: "tool.permission_requested",
        call: { id: "1", name: "bash", args: {} },
        tool: { name: "bash", description: "", permission: "ask" },
      }),
    )
    expect(out).toContain("permission bash")
  })

  test("context.compacted shows numbers", () => {
    const out = stripAnsi(
      renderEvent({ type: "context.compacted", messagesBefore: 20, messagesAfter: 8 }),
    )
    expect(out).toContain("20")
    expect(out).toContain("8")
  })
})
