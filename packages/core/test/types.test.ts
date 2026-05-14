/**
 * Type-level tests for `@omni/core`. The file passes if it typechecks —
 * type regressions surface as `tsc --noEmit` failures. Uses `expect-type`
 * for explicit type assertions; runtime assertions check public API exports.
 */
import { describe, test, expect } from "bun:test"
import { expectTypeOf } from "expect-type"
import { z } from "zod"
import type {
  EngineConfig,
  EngineEvent,
  Message,
  ModelAdapter,
  ModelEvent,
  Tool,
  ToolCall,
  ToolContext,
  ToolSchema,
  PermissionGate,
  PermissionDecision,
  ContextStrategy,
  CumulativeUsage,
  ClassifiedError,
  ErrorCategory,
} from "../src/index.ts"
import * as Core from "../src/index.ts"

// ─── Tool generic inference ────────────────────────────────────────────────

describe("Type tests — Tool", () => {
  test("execute() argument type is inferred from generic", () => {
    type Args = { x: number; tag: string }
    type Ret = { y: number }
    expectTypeOf<Tool<Args, Ret>["execute"]>()
      .parameter(0)
      .toEqualTypeOf<Args>()
    expectTypeOf<Tool<Args, Ret>["execute"]>()
      .parameter(1)
      .toEqualTypeOf<ToolContext>()
    expectTypeOf<Tool<Args, Ret>["execute"]>().returns.toEqualTypeOf<Promise<Ret>>()
  })

  test("Tool implementation rejects wrong return shape", () => {
    // @ts-expect-error — `execute` must return Promise<{ y: string }>
    const _bad: Tool<{ x: number }, { y: string }> = {
      name: "t",
      description: "",
      permission: "auto",
      schema: z.object({ x: z.number() }),
      async execute(_args) {
        return { wrong: true }
      },
    }
    void _bad
  })

  test("Tool schema source-of-truth pattern works", () => {
    const schema = z.object({ url: z.string(), retries: z.number().optional() })
    const t: Tool<z.infer<typeof schema>, { ok: boolean }> = {
      name: "fetch",
      description: "",
      permission: "ask",
      schema,
      async execute(args) {
        expectTypeOf(args).toEqualTypeOf<{ url: string; retries?: number }>()
        return { ok: true }
      },
    }
    expect(t.name).toBe("fetch")
  })

  test("ToolSchema.parameters is JSONSchema7-shaped", () => {
    expectTypeOf<ToolSchema["parameters"]>().toMatchTypeOf<object>()
    // JSONSchema7 has a `type` field — sample assertion that it's there.
    type P = ToolSchema["parameters"]
    expectTypeOf<P["type"]>().toBeNullable() // optional in JSONSchema7
  })
})

// ─── EngineEvent discrimination ────────────────────────────────────────────

describe("Type tests — EngineEvent", () => {
  test("discriminates by `type`", () => {
    const ev = {} as EngineEvent
    if (ev.type === "engine.done") {
      expectTypeOf(ev.reason).toEqualTypeOf<
        "model_done" | "max_iterations" | "aborted" | "loop_detected" | "fatal_error"
      >()
      expectTypeOf(ev.usage).toEqualTypeOf<CumulativeUsage>()
      expectTypeOf(ev.durationMs).toEqualTypeOf<number>()
    }
    if (ev.type === "tool.result") {
      expectTypeOf(ev.call).toEqualTypeOf<ToolCall>()
      expectTypeOf(ev.result).toEqualTypeOf<unknown>()
      expectTypeOf(ev.durationMs).toEqualTypeOf<number>()
    }
    if (ev.type === "engine.error") {
      expectTypeOf(ev.error).toEqualTypeOf<ClassifiedError>()
      expectTypeOf(ev.fatal).toEqualTypeOf<boolean>()
    }
  })

  test("all event types are covered by the union", () => {
    type EventType = EngineEvent["type"]
    // If a new event type is added without updating consumers, this assertion
    // becomes a useful focal point — extend the union below to acknowledge it.
    expectTypeOf<EventType>().toEqualTypeOf<
      | "engine.start"
      | "engine.iteration"
      | "engine.done"
      | "engine.error"
      | "engine.usage"
      | "engine.loop_detected"
      | "engine.retrying"
      | "engine.warning"
      | "model.start"
      | "model.delta"
      | "model.thinking_delta"
      | "model.tool_call_start"
      | "model.tool_call_args_delta"
      | "model.tool_call_done"
      | "model.done"
      | "tool.permission_requested"
      | "tool.permission_granted"
      | "tool.permission_denied"
      | "tool.invalid"
      | "tool.start"
      | "tool.progress"
      | "tool.result"
      | "tool.error"
      | "context.compacted"
    >()
  })
})

// ─── ModelEvent variants ───────────────────────────────────────────────────

describe("Type tests — ModelEvent", () => {
  test("required fields per variant", () => {
    // @ts-expect-error — `tool_call` requires `call`
    const _bad1: ModelEvent = { type: "tool_call" }
    // @ts-expect-error — `delta` requires `text`
    const _bad2: ModelEvent = { type: "delta" }
    // @ts-expect-error — `done` requires `finishReason`
    const _bad3: ModelEvent = { type: "done" }
    void _bad1
    void _bad2
    void _bad3
    const ok: ModelEvent = { type: "done", finishReason: "stop" }
    expect(ok.type).toBe("done")
  })
})

// ─── Message immutability ──────────────────────────────────────────────────

describe("Type tests — Message", () => {
  test("readonly fields reject reassignment at compile time", () => {
    const m: Message = { id: "x", role: "user", content: "hi", timestamp: 0 }
    // @ts-expect-error — id is readonly
    m.id = "y"
    // @ts-expect-error — role is readonly
    m.role = "system"
    expect(typeof m.id).toBe("string")
  })
})

// ─── EngineConfig strictness ───────────────────────────────────────────────

describe("Type tests — EngineConfig", () => {
  test("requires model + tools, others optional", () => {
    expectTypeOf<EngineConfig>().toMatchTypeOf<{ model: ModelAdapter; tools: readonly Tool[] }>()
  })

  test("rejects extra unknown fields", () => {
    // @ts-expect-error — `unknownOption` is not part of EngineConfig
    const _cfg: EngineConfig = {
      model: {} as ModelAdapter,
      tools: [],
      unknownOption: true,
    }
    void _cfg
  })

  test("tracer is typed against EngineEvent", () => {
    expectTypeOf<NonNullable<EngineConfig["tracer"]>>().parameter(0).toEqualTypeOf<EngineEvent>()
  })
})

// ─── PermissionGate contract ───────────────────────────────────────────────

describe("Type tests — PermissionGate", () => {
  test("check returns Promise<PermissionDecision>", () => {
    expectTypeOf<PermissionGate["check"]>().returns.toEqualTypeOf<Promise<PermissionDecision>>()
  })

  test("PermissionDecision is allow | deny only", () => {
    expectTypeOf<PermissionDecision>().toEqualTypeOf<"allow" | "deny">()
  })
})

// ─── ContextStrategy contract ──────────────────────────────────────────────

describe("Type tests — ContextStrategy", () => {
  test("fit takes readonly messages, returns readonly messages", () => {
    expectTypeOf<ContextStrategy["fit"]>()
      .parameter(0)
      .toEqualTypeOf<readonly Message[]>()
    expectTypeOf<ContextStrategy["fit"]>().returns.toEqualTypeOf<readonly Message[]>()
  })
})

// ─── ClassifiedError ───────────────────────────────────────────────────────

describe("Type tests — ClassifiedError", () => {
  test("extends Error and has all category fields", () => {
    expectTypeOf<ClassifiedError>().toMatchTypeOf<Error>()
    expectTypeOf<ClassifiedError["category"]>().toEqualTypeOf<ErrorCategory>()
    expectTypeOf<ClassifiedError["retryable"]>().toEqualTypeOf<boolean>()
  })

  test("ErrorCategory is the documented union", () => {
    expectTypeOf<ErrorCategory>().toEqualTypeOf<
      | "network"
      | "rate_limit"
      | "auth"
      | "context_overflow"
      | "invalid_request"
      | "tool_failure"
      | "aborted"
      | "internal"
      | "unknown"
    >()
  })
})

// ─── Public API exports ────────────────────────────────────────────────────

describe("Public API — runtime exports", () => {
  test("core classes", () => {
    expect(typeof Core.Engine).toBe("function")
    expect(typeof Core.ContextManager).toBe("function")
    expect(typeof Core.SlidingWindowStrategy).toBe("function")
    expect(typeof Core.AllowAllPermissions).toBe("function")
    expect(typeof Core.DenyAllPermissions).toBe("function")
    expect(typeof Core.StaticPermissions).toBe("function")
    expect(typeof Core.AskPermissions).toBe("function")
    expect(typeof Core.AsyncQueue).toBe("function")
  })

  test("utilities", () => {
    expect(typeof Core.classifyError).toBe("function")
    expect(typeof Core.combineSignals).toBe("function")
    expect(typeof Core.mergeStreams).toBe("function")
    expect(typeof Core.sleep).toBe("function")
    expect(typeof Core.validateToolCall).toBe("function")
    expect(typeof Core.toToolSchema).toBe("function")
    expect(typeof Core.parseReActFallback).toBe("function")
    expect(typeof Core.estimateTokens).toBe("function")
  })
})
