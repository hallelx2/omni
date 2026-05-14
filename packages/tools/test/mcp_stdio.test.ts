import { afterEach, describe, expect, test } from "bun:test"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { MCPClient } from "../src/mcp.ts"

const __filename = fileURLToPath(import.meta.url)
const SERVER_PATH = resolve(dirname(__filename), "fixtures", "mcp-stdio-server.ts")

let cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanups) {
    try {
      await fn()
    } catch {
      // ignore
    }
  }
  cleanups = []
})

describe("MCPClient — stdio transport (real subprocess)", () => {
  test("spawns a Bun subprocess, lists tools, invokes one", async () => {
    const client = new MCPClient({
      kind: "stdio",
      command: process.execPath, // current Bun/Node binary
      args: ["run", SERVER_PATH],
    })
    cleanups.push(() => client.close())

    await client.connect()
    const tools = client.tools()
    expect(tools.map((t) => t.name)).toEqual(["ping"])

    const ping = tools[0]!
    const result = await ping.execute(
      { value: "stdio-works" },
      { cwd: process.cwd(), signal: new AbortController().signal },
    )
    expect(result).toBe("pong: stdio-works")
  }, 20_000)
})
