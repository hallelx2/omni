/**
 * End-to-end test for OpenAICompatibleAdapter through the full pipeline:
 *   adapter → @ai-sdk/openai-compatible → SSE parser → translateStream → ModelEvent
 *
 * We inject a fake `fetch` so no network is touched. The body is constructed
 * to match the OpenAI Chat Completions streaming format.
 */
import { describe, expect, test } from "bun:test"
import type { ModelEvent } from "@omni/core"
import { OpenAICompatibleAdapter } from "../src/openai-compatible.ts"

function sse(chunks: ReadonlyArray<object | "DONE">): Response {
  const body = chunks
    .map((c) => (c === "DONE" ? "data: [DONE]\n\n" : `data: ${JSON.stringify(c)}\n\n`))
    .join("")
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  })
}

async function collect(stream: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = []
  for await (const e of stream) out.push(e)
  return out
}

describe("OpenAICompatibleAdapter — end-to-end with fake fetch", () => {
  test("streams text deltas and emits done with usage", async () => {
    const fakeFetch: typeof fetch = async () =>
      sse([
        {
          id: "1",
          object: "chat.completion.chunk",
          choices: [
            { index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null },
          ],
        },
        {
          id: "1",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }],
        },
        {
          id: "1",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        },
        "DONE",
      ])

    const adapter = new OpenAICompatibleAdapter({
      baseURL: "http://fake.example/v1",
      apiKey: "test",
      model: "test-model",
      fetch: fakeFetch,
      capabilities: { costPer1kInput: 0.001, costPer1kOutput: 0.003 },
    })

    const events = await collect(
      adapter.complete({
        messages: [{ id: "u1", role: "user", content: "hi", timestamp: 0 }],
        tools: [],
        signal: new AbortController().signal,
      }),
    )

    const deltas = events.filter((e) => e.type === "delta")
    const text = deltas.map((e) => (e as { text: string }).text).join("")
    expect(text).toBe("Hello world")

    const done = events.find((e) => e.type === "done")
    expect(done?.type).toBe("done")
    if (done?.type === "done") {
      expect(done.finishReason).toBe("stop")
      expect(done.usage?.promptTokens).toBe(5)
      expect(done.usage?.completionTokens).toBe(2)
      // costUsd = (5 * 0.001 + 2 * 0.003) / 1000 = 0.000011
      expect(done.usage?.costUsd).toBeCloseTo(0.000011, 6)
    }
  })

  test("streams tool calls", async () => {
    const fakeFetch: typeof fetch = async () =>
      sse([
        {
          id: "1",
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "call_abc",
                    type: "function",
                    function: { name: "echo", arguments: "" },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: "1",
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: '{"text":"hi"}' } }],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: "1",
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
        "DONE",
      ])

    const adapter = new OpenAICompatibleAdapter({
      baseURL: "http://fake.example/v1",
      apiKey: "test",
      model: "test-model",
      fetch: fakeFetch,
    })

    const events = await collect(
      adapter.complete({
        messages: [{ id: "u1", role: "user", content: "say hi", timestamp: 0 }],
        tools: [
          {
            name: "echo",
            description: "echo input",
            parameters: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
            },
          },
        ],
        signal: new AbortController().signal,
      }),
    )

    const toolCalls = events.filter((e) => e.type === "tool_call")
    expect(toolCalls).toHaveLength(1)
    const call = (toolCalls[0]! as { call: { name: string; args: unknown; id: string } }).call
    expect(call.name).toBe("echo")
    expect(call.args).toEqual({ text: "hi" })
    expect(call.id).toBeTruthy()

    const done = events.find((e) => e.type === "done")
    if (done?.type === "done") {
      expect(done.finishReason).toBe("tool_calls")
    }
  })

  test("aborts mid-stream when signal fires", async () => {
    const fakeFetch: typeof fetch = async (_url, init) => {
      // Slow chunked stream — gives time to abort
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        async start(controller) {
          try {
            const send = (obj: object | "DONE") => {
              const line = obj === "DONE" ? "data: [DONE]\n\n" : `data: ${JSON.stringify(obj)}\n\n`
              controller.enqueue(encoder.encode(line))
            }
            send({
              choices: [
                { index: 0, delta: { role: "assistant", content: "a" }, finish_reason: null },
              ],
            })
            // Wait, but listen for abort.
            await new Promise<void>((resolve, reject) => {
              const t = setTimeout(resolve, 500)
              init?.signal?.addEventListener("abort", () => {
                clearTimeout(t)
                reject(new DOMException("Aborted", "AbortError"))
              })
            })
            send({
              choices: [{ index: 0, delta: { content: "b" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
            })
            send("DONE")
            controller.close()
          } catch (e) {
            controller.error(e)
          }
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    }

    const adapter = new OpenAICompatibleAdapter({
      baseURL: "http://fake.example/v1",
      apiKey: "test",
      model: "test-model",
      fetch: fakeFetch,
    })

    const ac = new AbortController()
    setTimeout(() => ac.abort(), 50)

    const events: ModelEvent[] = []
    for await (const ev of adapter.complete({
      messages: [{ id: "u1", role: "user", content: "hi", timestamp: 0 }],
      tools: [],
      signal: ac.signal,
    })) {
      events.push(ev)
    }

    // We should have gotten the first delta but never the final done with finishReason "stop".
    const done = events.find((e) => e.type === "done")
    expect(done?.type === "done" ? done.finishReason : undefined).not.toBe("stop")
    // An error or abort event should appear.
    const err = events.find((e) => e.type === "error")
    expect(err?.type).toBe("error")
  })
})
