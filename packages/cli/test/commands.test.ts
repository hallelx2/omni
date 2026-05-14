import { describe, expect, test } from "bun:test"
import { Engine, AllowAllPermissions } from "@omni/core"
import { MockAdapter } from "@omni/adapters"
import { tryDispatchCommand, listCommands } from "../src/commands.ts"

function mkEngine() {
  return new Engine({
    model: new MockAdapter({ script: [{ kind: "text", text: "ok" }] }),
    tools: [],
    permissions: new AllowAllPermissions(),
  })
}

describe("tryDispatchCommand", () => {
  test("returns null for non-slash input", async () => {
    const r = await tryDispatchCommand("hello world", { engine: mkEngine(), modelName: "x" })
    expect(r).toBeNull()
  })

  test("/help lists commands", async () => {
    const r = await tryDispatchCommand("/help", { engine: mkEngine(), modelName: "x" })
    expect(r?.kind).toBe("message")
    if (r?.kind === "message") {
      expect(r.text).toContain("/help")
      expect(r.text).toContain("/quit")
    }
  })

  test("/quit returns exit", async () => {
    const r = await tryDispatchCommand("/quit", { engine: mkEngine(), modelName: "x" })
    expect(r?.kind).toBe("exit")
  })

  test("/exit also returns exit (alias)", async () => {
    const r = await tryDispatchCommand("/exit", { engine: mkEngine(), modelName: "x" })
    expect(r?.kind).toBe("exit")
  })

  test("unknown command produces helpful message", async () => {
    const r = await tryDispatchCommand("/nope", { engine: mkEngine(), modelName: "x" })
    expect(r?.kind).toBe("message")
    if (r?.kind === "message") expect(r.text).toContain("Unknown command")
  })

  test("/usage reports engine totals", async () => {
    const e = mkEngine()
    const r = await tryDispatchCommand("/usage", { engine: e, modelName: "x" })
    expect(r?.kind).toBe("message")
    if (r?.kind === "message") {
      expect(r.text).toContain("tokens")
      expect(r.text).toContain("calls")
    }
  })

  test("/session shows the sessionId", async () => {
    const e = mkEngine()
    const r = await tryDispatchCommand("/session", { engine: e, modelName: "x" })
    if (r?.kind === "message") {
      expect(r.text).toContain(e.sessionId())
    }
  })

  test("/model shows the active model", async () => {
    const r = await tryDispatchCommand("/model", {
      engine: mkEngine(),
      modelName: "mimo-v2.5-pro",
    })
    if (r?.kind === "message") {
      expect(r.text).toContain("mimo-v2.5-pro")
    }
  })

  test("listCommands returns the full set", () => {
    const cs = listCommands()
    expect(cs.length).toBeGreaterThanOrEqual(6)
    expect(cs.find((c) => c.name === "help")).toBeDefined()
  })
})
