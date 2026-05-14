import { describe, expect, test } from "bun:test"
import type { ToolSchema } from "@omni/core"
import { toolsToAISDK } from "../src/util/tools.ts"

describe("toolsToAISDK", () => {
  test("translates name + description + parameters", () => {
    const schemas: ToolSchema[] = [
      {
        name: "echo",
        description: "Echo input",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
    ]
    const out = toolsToAISDK(schemas)
    expect(Object.keys(out)).toEqual(["echo"])
    expect(out["echo"]).toBeDefined()
    expect((out["echo"] as { description?: string }).description).toBe("Echo input")
  })

  test("translates multiple tools", () => {
    const schemas: ToolSchema[] = [
      { name: "a", description: "", parameters: { type: "object" } },
      { name: "b", description: "", parameters: { type: "object" } },
      { name: "c", description: "", parameters: { type: "object" } },
    ]
    const out = toolsToAISDK(schemas)
    expect(Object.keys(out).sort()).toEqual(["a", "b", "c"])
  })

  test("does NOT attach an execute function (engine owns execution)", () => {
    const schemas: ToolSchema[] = [
      { name: "echo", description: "", parameters: { type: "object" } },
    ]
    const out = toolsToAISDK(schemas)
    const t = out["echo"] as { execute?: unknown }
    expect(t.execute).toBeUndefined()
  })

  test("empty input → empty record", () => {
    const out = toolsToAISDK([])
    expect(out).toEqual({})
  })
})
