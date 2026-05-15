import { describe, expect, test } from "bun:test"
import { MCPManager } from "../src/mcp-manager.ts"

describe("MCPManager", () => {
  test("idle with no servers configured", () => {
    const mgr = new MCPManager({})
    expect(mgr.status()).toEqual([])
    expect(mgr.tools()).toEqual([])
    expect(mgr.connected()).toEqual([])
  })

  test("expands ${ENV} in stdio env vars", () => {
    process.env.OMNI_TEST_TOKEN = "secret-value"
    const mgr = new MCPManager({
      gh: {
        kind: "stdio",
        command: "true",
        args: ["${OMNI_TEST_TOKEN}"],
        env: { GH_TOKEN: "${OMNI_TEST_TOKEN}" },
      },
    })
    const state = mgr.status()[0]!
    expect((state.config as { args?: string[] }).args).toEqual(["secret-value"])
    delete process.env.OMNI_TEST_TOKEN
  })

  test("expands ${ENV} in http headers", () => {
    process.env.OMNI_TEST_KEY = "abc"
    const mgr = new MCPManager({
      api: {
        kind: "http",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer ${OMNI_TEST_KEY}" },
      },
    })
    const state = mgr.status()[0]!
    expect((state.config as { headers?: Record<string, string> }).headers?.Authorization).toBe(
      "Bearer abc",
    )
    delete process.env.OMNI_TEST_KEY
  })

  test("failed connection is reported per-server", async () => {
    const mgr = new MCPManager({
      bad: {
        kind: "stdio",
        command: "/this/binary/does/not/exist/anywhere",
      },
    })
    await mgr.connectAll()
    const state = mgr.status().find((s) => s.name === "bad")!
    expect(state.status).toBe("failed")
    expect(state.error).toBeTruthy()
  })

  test("failure of one server does not block others", async () => {
    const mgr = new MCPManager({
      bad: { kind: "stdio", command: "/nonexistent" },
      other: { kind: "stdio", command: "/also-nonexistent" },
    })
    await mgr.connectAll()
    const states = mgr.status()
    expect(states.length).toBe(2)
    expect(states.every((s) => s.status === "failed")).toBe(true)
  })

  test("connectAll → tools → closeAll without crashing", async () => {
    const mgr = new MCPManager({})
    await mgr.connectAll()
    expect(mgr.tools()).toEqual([])
    await mgr.closeAll()
  })

  test("restart of unknown server throws", async () => {
    const mgr = new MCPManager({})
    await expect(mgr.restart("nope")).rejects.toThrow(/unknown MCP server/)
  })
})
