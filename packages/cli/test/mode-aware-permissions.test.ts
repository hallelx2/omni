import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { ulid } from "ulid"
import { AllowAllPermissions, DenyAllPermissions, type Tool, type ToolCall } from "@omni/core"
import { ModeAwarePermissions } from "../src/mode-aware-permissions.ts"
import type { RunMode } from "../src/mode.ts"

const mkTool = (name: string, permission: "auto" | "ask" | "deny" = "ask"): Tool => ({
  name,
  description: "",
  permission,
  schema: z.any(),
  execute: async () => undefined,
})
const mkCall = (name: string): ToolCall => ({ id: ulid(), name, args: {} })

describe("ModeAwarePermissions", () => {
  test("auto mode short-circuits to allow regardless of the inner gate", async () => {
    const g = new ModeAwarePermissions(new DenyAllPermissions(), () => "auto" as RunMode)
    expect(await g.check(mkTool("write_file"), mkCall("write_file"))).toBe("allow")
    expect(await g.check(mkTool("bash"), mkCall("bash"))).toBe("allow")
  })

  test("non-auto delegates to the inner gate", async () => {
    let mode: RunMode = "build"
    const g = new ModeAwarePermissions(new DenyAllPermissions(), () => mode)
    expect(await g.check(mkTool("write_file"), mkCall("write_file"))).toBe("deny")
    mode = "plan"
    expect(await g.check(mkTool("read_file"), mkCall("read_file"))).toBe("deny")
  })

  test("tool.permission 'deny' wins even in auto mode", async () => {
    const g = new ModeAwarePermissions(new AllowAllPermissions(), () => "auto" as RunMode)
    expect(await g.check(mkTool("evil", "deny"), mkCall("evil"))).toBe("deny")
  })

  test("mode switches are picked up on the next call (live read)", async () => {
    let mode: RunMode = "build"
    const g = new ModeAwarePermissions(new DenyAllPermissions(), () => mode)
    expect(await g.check(mkTool("write_file"), mkCall("write_file"))).toBe("deny")
    mode = "auto"
    expect(await g.check(mkTool("write_file"), mkCall("write_file"))).toBe("allow")
  })
})
