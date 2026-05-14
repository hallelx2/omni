import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { z } from "zod"
import { type EngineConfig, type Tool, type ToolContext } from "@omni/core"
import { MockAdapter, type MockScript } from "@omni/adapters"
import { OmniServer } from "../src/server.ts"

let server: OmniServer | null = null
let url = ""

function makeServer(opts: { interactivePermissions: boolean } = { interactivePermissions: true }) {
  const echo: Tool<{ text: string }, { text: string }> = {
    name: "echo",
    description: "Echo input",
    permission: "ask",
    schema: z.object({ text: z.string() }),
    async execute(args, _ctx: ToolContext) {
      return { text: args.text }
    },
  }
  const script: MockScript[] = [
    { kind: "tool", name: "echo", args: { text: "hello" } },
    { kind: "text", text: "done" },
  ]
  const cfg = (): EngineConfig => ({
    model: new MockAdapter({ script }),
    tools: [echo],
  })
  return new OmniServer({ port: 0, engineConfig: cfg, ...opts, permissionTimeoutMs: 500 })
}

beforeEach(() => {
  server = makeServer()
  const info = server.start()
  url = `http://${info.hostname}:${info.port}`
})

afterEach(() => {
  server?.stop()
  server = null
})

describe("OmniServer permission forwarding", () => {
  test("server sends permission.request and waits for client decision", async () => {
    const wsUrl = url.replace(/^http/, "ws") + "/ws"
    const got = await new Promise<{
      requests: number
      gotToolResult: boolean
      gotEngineDone: boolean
    }>((resolve, reject) => {
      let requests = 0
      let gotToolResult = false
      let gotEngineDone = false
      const ws = new WebSocket(wsUrl)
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error("test timed out"))
      }, 8_000)
      ws.onmessage = (e) => {
        const ev = JSON.parse(String(e.data)) as Record<string, unknown>
        if (ev.type === "permission.request") {
          requests++
          ws.send(
            JSON.stringify({
              type: "permission.response",
              requestId: ev.requestId,
              decision: "allow",
            }),
          )
        }
        if (ev.type === "tool.result") gotToolResult = true
        if (ev.type === "engine.done") {
          gotEngineDone = true
          clearTimeout(timer)
          ws.close()
          resolve({ requests, gotToolResult, gotEngineDone })
        }
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error("ws error"))
      }
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "run", input: "go" }))
      }
    })
    expect(got.requests).toBeGreaterThanOrEqual(1)
    expect(got.gotToolResult).toBe(true)
    expect(got.gotEngineDone).toBe(true)
  })

  test("client deny propagates to tool.permission_denied", async () => {
    const wsUrl = url.replace(/^http/, "ws") + "/ws"
    const got = await new Promise<boolean>((resolve, reject) => {
      let denied = false
      const ws = new WebSocket(wsUrl)
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error("test timed out"))
      }, 8_000)
      ws.onmessage = (e) => {
        const ev = JSON.parse(String(e.data)) as Record<string, unknown>
        if (ev.type === "permission.request") {
          ws.send(
            JSON.stringify({
              type: "permission.response",
              requestId: ev.requestId,
              decision: "deny",
            }),
          )
        }
        if (ev.type === "tool.permission_denied") denied = true
        if (ev.type === "engine.done") {
          clearTimeout(timer)
          ws.close()
          resolve(denied)
        }
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error("ws error"))
      }
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "run", input: "go" }))
      }
    })
    expect(got).toBe(true)
  })

  test("timeout falls back to deny when client doesn't respond", async () => {
    const wsUrl = url.replace(/^http/, "ws") + "/ws"
    const got = await new Promise<boolean>((resolve, reject) => {
      let denied = false
      const ws = new WebSocket(wsUrl)
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error("test timed out"))
      }, 8_000)
      ws.onmessage = (e) => {
        const ev = JSON.parse(String(e.data)) as Record<string, unknown>
        // intentionally never respond to permission.request
        if (ev.type === "tool.permission_denied") denied = true
        if (ev.type === "engine.done") {
          clearTimeout(timer)
          ws.close()
          resolve(denied)
        }
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error("ws error"))
      }
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "run", input: "go" }))
      }
    })
    expect(got).toBe(true)
  })
})
