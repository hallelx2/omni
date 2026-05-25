import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { loadAgents, agentPermissionGate, type Agent } from "../src/agents.ts"
import type { Tool, ToolCall } from "@omni/core"

const tool = (name: string): Tool => ({
  name,
  description: "",
  permission: "auto",
  schema: z.any(),
  execute: async () => ({}),
})
const call = (args: unknown): ToolCall => ({ id: "c1", name: "x", args })

describe("agentPermissionGate", () => {
  test("test agent: allows test runners, denies arbitrary + destructive bash", async () => {
    const gate = agentPermissionGate(loadAgents().get("test")!)
    expect(await gate.check(tool("bash"), call({ command: "bun test packages/core" }))).toBe("allow")
    expect(await gate.check(tool("bash"), call({ command: "ls -la" }))).toBe("deny")
    expect(await gate.check(tool("bash"), call({ command: "rm -rf /" }))).toBe("deny")
  })

  test("test agent: writes only test files, reads anything", async () => {
    const gate = agentPermissionGate(loadAgents().get("test")!)
    expect(await gate.check(tool("write_file"), call({ path: "src/foo.test.ts" }))).toBe("allow")
    expect(await gate.check(tool("write_file"), call({ path: "src/app.ts" }))).toBe("deny")
    expect(await gate.check(tool("read_file"), call({ path: "src/app.ts" }))).toBe("allow")
  })

  test("explore agent: read-only; denies writes and bash", async () => {
    const gate = agentPermissionGate(loadAgents().get("explore")!)
    expect(await gate.check(tool("read_file"), call({ path: "x" }))).toBe("allow")
    expect(await gate.check(tool("glob"), call({ pattern: "**/*.ts" }))).toBe("allow")
    expect(await gate.check(tool("write_file"), call({ path: "x.ts" }))).toBe("deny")
    expect(await gate.check(tool("bash"), call({ command: "ls" }))).toBe("deny")
  })

  test("critique agent: allows git inspection, denies mutation", async () => {
    const gate = agentPermissionGate(loadAgents().get("critique")!)
    expect(await gate.check(tool("bash"), call({ command: "git diff HEAD" }))).toBe("allow")
    expect(await gate.check(tool("bash"), call({ command: "git push origin main" }))).toBe("deny")
    expect(await gate.check(tool("write_file"), call({ path: "x" }))).toBe("deny")
  })

  test("deny rules win over allow; non-matching falls to default deny", async () => {
    const agent: Agent = {
      name: "x",
      description: "",
      systemPrompt: "",
      source: "user",
      path: "",
      tools: ["bash"],
      permissionDefault: "deny",
      permissions: { bash: { allow: ["^echo "], deny: ["secret"] } },
    }
    const gate = agentPermissionGate(agent)
    expect(await gate.check(tool("bash"), call({ command: "echo hi" }))).toBe("allow")
    expect(await gate.check(tool("bash"), call({ command: "echo secret" }))).toBe("deny")
    expect(await gate.check(tool("bash"), call({ command: "cat /etc/passwd" }))).toBe("deny")
  })

  test("permissionDefault allow lets unlisted calls through", async () => {
    const agent: Agent = {
      name: "x",
      description: "",
      systemPrompt: "",
      source: "user",
      path: "",
      tools: [],
      permissionDefault: "allow",
    }
    const gate = agentPermissionGate(agent)
    expect(await gate.check(tool("anything"), call({}))).toBe("allow")
  })
})
