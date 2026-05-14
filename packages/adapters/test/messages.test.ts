import { describe, expect, test } from "bun:test"
import type { Message } from "@omni/core"
import { messagesToAISDK } from "../src/util/messages.ts"

function m(partial: Partial<Message> & { role: Message["role"]; content: string }): Message {
  return {
    id: partial.id ?? "id",
    role: partial.role,
    content: partial.content,
    toolCalls: partial.toolCalls,
    toolCallId: partial.toolCallId,
    timestamp: partial.timestamp ?? 0,
    metadata: partial.metadata,
  }
}

describe("messagesToAISDK", () => {
  test("system message", () => {
    const out = messagesToAISDK([m({ role: "system", content: "be helpful" })])
    expect(out).toEqual([{ role: "system", content: "be helpful" }])
  })

  test("user message", () => {
    const out = messagesToAISDK([m({ role: "user", content: "hi" })])
    expect(out).toEqual([{ role: "user", content: "hi" }])
  })

  test("assistant message with text only", () => {
    const out = messagesToAISDK([m({ role: "assistant", content: "hello" })])
    expect(out).toEqual([{ role: "assistant", content: "hello" }])
  })

  test("assistant message with one tool call", () => {
    const out = messagesToAISDK([
      m({
        role: "assistant",
        content: "calling tool",
        toolCalls: [{ id: "c1", name: "echo", args: { text: "x" } }],
      }),
    ])
    expect(out).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "calling tool" },
          { type: "tool-call", toolCallId: "c1", toolName: "echo", input: { text: "x" } },
        ],
      },
    ])
  })

  test("assistant message with multiple parallel tool calls", () => {
    const out = messagesToAISDK([
      m({
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "c1", name: "echo", args: { a: 1 } },
          { id: "c2", name: "fetch", args: { url: "/x" } },
        ],
      }),
    ])
    expect(out).toHaveLength(1)
    const first = out[0]!
    expect(first.role).toBe("assistant")
    expect(Array.isArray(first.content)).toBe(true)
    const parts = first.content as Array<{ type: string; toolName?: string }>
    expect(parts.filter((p) => p.type === "tool-call")).toHaveLength(2)
    // Empty text part should be omitted when content is empty.
    expect(parts.filter((p) => p.type === "text")).toHaveLength(0)
  })

  test("tool result message finds toolName from prior assistant turn", () => {
    const out = messagesToAISDK([
      m({
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "echo", args: { text: "x" } }],
      }),
      m({ role: "tool", content: '{"ok":true}', toolCallId: "c1" }),
    ])
    const toolMsg = out[out.length - 1]!
    expect(toolMsg.role).toBe("tool")
    const parts = toolMsg.content as Array<{ toolName: string; toolCallId: string }>
    expect(parts[0]!.toolName).toBe("echo")
    expect(parts[0]!.toolCallId).toBe("c1")
  })

  test("tool result with no matching call uses fallback name", () => {
    const out = messagesToAISDK([
      m({ role: "tool", content: "orphan", toolCallId: "missing" }),
    ])
    const parts = (out[0]!.content as Array<{ toolName: string }>) ?? []
    expect(parts[0]?.toolName).toBe("unknown")
  })

  test("tool message without id falls back to user note", () => {
    const out = messagesToAISDK([m({ role: "tool", content: "orphaned" })])
    expect(out).toHaveLength(1)
    expect(out[0]!.role).toBe("user")
    expect(typeof out[0]!.content === "string" && out[0]!.content.includes("orphaned")).toBe(true)
  })

  test("assistant message with reasoning roundtrips via providerOptions", () => {
    const out = messagesToAISDK([
      m({
        role: "assistant",
        content: "result",
        metadata: { reasoningContent: "I thought about it..." },
      }),
    ])
    const msg = out[0] as { role: string; providerOptions?: Record<string, unknown> }
    expect(msg.role).toBe("assistant")
    expect(msg.providerOptions).toBeDefined()
    const oai = msg.providerOptions?.openaiCompatible as Record<string, unknown> | undefined
    expect(oai?.reasoning_content).toBe("I thought about it...")
    const anth = msg.providerOptions?.anthropic as Record<string, unknown> | undefined
    expect((anth?.thinking as Record<string, unknown>).thinking).toBe("I thought about it...")
  })

  test("assistant message with reasoning AND tool calls keeps both", () => {
    const out = messagesToAISDK([
      m({
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "echo", args: { text: "x" } }],
        metadata: { reasoningContent: "reasoning text" },
      }),
    ])
    const msg = out[0] as { role: string; providerOptions?: Record<string, unknown>; content: unknown }
    expect(msg.role).toBe("assistant")
    expect(Array.isArray(msg.content)).toBe(true)
    expect(msg.providerOptions).toBeDefined()
  })

  test("preserves order across a multi-turn exchange", () => {
    const history: Message[] = [
      m({ role: "system", content: "sys" }),
      m({ role: "user", content: "u1" }),
      m({
        role: "assistant",
        content: "a1",
        toolCalls: [{ id: "c1", name: "echo", args: { x: 1 } }],
      }),
      m({ role: "tool", content: "result", toolCallId: "c1" }),
      m({ role: "assistant", content: "final" }),
    ]
    const out = messagesToAISDK(history)
    expect(out.map((x) => x.role)).toEqual(["system", "user", "assistant", "tool", "assistant"])
  })
})
