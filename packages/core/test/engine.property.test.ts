import { describe, test, expect } from "bun:test"
import fc from "fast-check"
import { z } from "zod"
import { Engine, type EngineEvent, type Tool } from "../src/index.ts"
import { MockAdapter, type MockScript } from "../../adapters/src/mock.ts"

const echoTool: Tool<{ text: string }, { text: string }> = {
  name: "echo",
  description: "Echo input",
  permission: "auto",
  schema: z.object({ text: z.string() }),
  async execute(args) {
    return { text: args.text }
  },
}

const scriptEntryArb = fc.oneof(
  fc.record({
    kind: fc.constant<"text">("text"),
    text: fc.string({ maxLength: 30 }),
  }),
  fc.record({
    kind: fc.constant<"tool">("tool"),
    name: fc.constant("echo"),
    args: fc.record({ text: fc.string({ maxLength: 10 }) }),
  }),
)

const scriptArb = fc.array(scriptEntryArb, { minLength: 1, maxLength: 6 })

async function collect(stream: AsyncIterable<EngineEvent>): Promise<EngineEvent[]> {
  const out: EngineEvent[] = []
  for await (const ev of stream) out.push(ev)
  return out
}

describe("Engine — properties", () => {
  test("engine.done is always the last event and appears exactly once", async () => {
    await fc.assert(
      fc.asyncProperty(scriptArb, async (script) => {
        const engine = new Engine({
          model: new MockAdapter({ script: script as MockScript[] }),
          tools: [echoTool],
          maxIterations: 10,
          loopDetectionThreshold: 999,
        })
        const events = await collect(engine.run("input"))
        const doneCount = events.filter((e) => e.type === "engine.done").length
        return (
          doneCount === 1 &&
          events.length > 0 &&
          events[events.length - 1]!.type === "engine.done"
        )
      }),
      { numRuns: 30 },
    )
  })

  test("engine.iteration count never exceeds maxIterations", async () => {
    await fc.assert(
      fc.asyncProperty(
        scriptArb,
        fc.integer({ min: 1, max: 8 }),
        async (script, maxIter) => {
          const engine = new Engine({
            model: new MockAdapter({ script: script as MockScript[] }),
            tools: [echoTool],
            maxIterations: maxIter,
            loopDetectionThreshold: 999,
          })
          const events = await collect(engine.run("input"))
          const iters = events.filter((e) => e.type === "engine.iteration").length
          return iters <= maxIter
        },
      ),
      { numRuns: 30 },
    )
  })

  test("every tool.start is followed by exactly one of result|error|invalid|denied for the same call", async () => {
    await fc.assert(
      fc.asyncProperty(scriptArb, async (script) => {
        const engine = new Engine({
          model: new MockAdapter({ script: script as MockScript[] }),
          tools: [echoTool],
          maxIterations: 10,
          loopDetectionThreshold: 999,
        })
        const events = await collect(engine.run("input"))
        const starts = events.filter((e) => e.type === "tool.start")
        for (const start of starts) {
          if (start.type !== "tool.start") continue
          const startIdx = events.indexOf(start)
          const after = events.slice(startIdx + 1)
          const terminals = after.filter(
            (e) =>
              (e.type === "tool.result" ||
                e.type === "tool.error" ||
                e.type === "tool.invalid" ||
                e.type === "tool.permission_denied") &&
              "call" in e &&
              e.call.id === start.call.id,
          )
          if (terminals.length !== 1) return false
        }
        return true
      }),
      { numRuns: 30 },
    )
  })

  test("abort before any iteration terminates with reason 'aborted'", async () => {
    await fc.assert(
      fc.asyncProperty(scriptArb, async (script) => {
        const engine = new Engine({
          model: new MockAdapter({ script: script as MockScript[] }),
          tools: [echoTool],
          maxIterations: 10,
        })
        const ac = new AbortController()
        ac.abort()
        const events = await collect(engine.run("input", { signal: ac.signal }))
        const done = events.find((e) => e.type === "engine.done")
        return done?.type === "engine.done" && done.reason === "aborted"
      }),
      { numRuns: 20 },
    )
  })
})
