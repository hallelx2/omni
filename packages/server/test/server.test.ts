import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { AllowAllPermissions, type EngineConfig } from "@omni/core"
import { MockAdapter, type MockScript } from "@omni/adapters"
import { OmniServer } from "../src/server.ts"

let server: OmniServer | null = null
let url = ""

beforeEach(() => {
  const script: MockScript[] = [{ kind: "text", text: "hello from mock" }]
  const cfg = (): EngineConfig => ({
    model: new MockAdapter({ script }),
    tools: [],
    permissions: new AllowAllPermissions(),
  })
  server = new OmniServer({ port: 0, engineConfig: cfg })
  const info = server.start()
  url = `http://${info.hostname}:${info.port}`
})

afterEach(() => {
  server?.stop()
  server = null
})

describe("OmniServer", () => {
  test("GET /health returns 200 ok", async () => {
    const res = await fetch(`${url}/health`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe("ok")
  })

  test("GET /version returns json", async () => {
    const res = await fetch(`${url}/version`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe("omni-server")
  })

  test("GET /unknown returns 404", async () => {
    const res = await fetch(`${url}/nope`)
    expect(res.status).toBe(404)
  })

  test("WS /ws streams engine events for run command", async () => {
    const wsUrl = url.replace(/^http/, "ws") + "/ws"
    const events = await new Promise<unknown[]>((resolve, reject) => {
      const out: unknown[] = []
      const ws = new WebSocket(wsUrl)
      const timer = setTimeout(() => {
        ws.close()
        reject(new Error("timeout"))
      }, 5_000)
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(String(e.data))
          out.push(data)
          if ((data as { type?: string }).type === "engine.done") {
            clearTimeout(timer)
            ws.close()
            resolve(out)
          }
        } catch {
          // ignore
        }
      }
      ws.onerror = () => {
        clearTimeout(timer)
        reject(new Error("ws error"))
      }
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "run", input: "hi" }))
      }
    })
    const types = events.map((e) => (e as { type: string }).type)
    expect(types).toContain("server.hello")
    expect(types).toContain("engine.start")
    expect(types).toContain("engine.done")
  })
})

describe("OmniServer auth", () => {
  test("rejects without bearer when authToken is configured", async () => {
    const cfg = (): EngineConfig => ({
      model: new MockAdapter({ script: [] }),
      tools: [],
      permissions: new AllowAllPermissions(),
    })
    const s = new OmniServer({ port: 0, engineConfig: cfg, authToken: "secret" })
    const info = s.start()
    try {
      const res = await fetch(`http://${info.hostname}:${info.port}/health`)
      expect(res.status).toBe(401)
      const ok = await fetch(`http://${info.hostname}:${info.port}/health`, {
        headers: { Authorization: "Bearer secret" },
      })
      expect(ok.status).toBe(200)
    } finally {
      s.stop()
    }
  })
})
