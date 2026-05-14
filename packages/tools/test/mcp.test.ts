import { afterEach, describe, expect, test } from "bun:test"
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { MCPClient } from "../src/mcp.ts"

let cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanup) await fn()
  cleanup = []
})

async function spinUpEchoServer(): Promise<{ clientTransport: InMemoryTransport }> {
  const server = new McpServer({ name: "test-server", version: "0.0.0" })

  server.registerTool(
    "echo",
    {
      title: "Echo",
      description: "Returns the input text",
      inputSchema: { text: z.string() },
    },
    async ({ text }) => ({ content: [{ type: "text", text }] }),
  )

  server.registerTool(
    "boom",
    { title: "Boom", description: "Always errors", inputSchema: {} },
    async () => ({
      isError: true,
      content: [{ type: "text", text: "intentional failure" }],
    }),
  )

  const [c, s] = InMemoryTransport.createLinkedPair()
  await server.connect(s)
  cleanup.push(async () => {
    await server.close()
  })
  return { clientTransport: c }
}

function ctx() {
  return { cwd: process.cwd(), signal: new AbortController().signal }
}

describe("MCPClient", () => {
  test("lists tools after connect", async () => {
    const { clientTransport } = await spinUpEchoServer()
    const client = new MCPClient({ kind: "stdio", command: "ignored" })
    cleanup.push(() => client.close())
    await client.connectWithTransport(clientTransport)

    const tools = client.tools()
    expect(tools.map((t) => t.name).sort()).toEqual(["boom", "echo"])
    expect(tools.find((t) => t.name === "echo")?.description).toBe("Returns the input text")
  })

  test("invokes a tool and returns text", async () => {
    const { clientTransport } = await spinUpEchoServer()
    const client = new MCPClient({ kind: "stdio", command: "ignored" })
    cleanup.push(() => client.close())
    await client.connectWithTransport(clientTransport)

    const echo = client.tools().find((t) => t.name === "echo")!
    const result = await echo.execute({ text: "hi from mcp" }, ctx())
    expect(result).toBe("hi from mcp")
  })

  test("tool error from server becomes a thrown Error", async () => {
    const { clientTransport } = await spinUpEchoServer()
    const client = new MCPClient({ kind: "stdio", command: "ignored" })
    cleanup.push(() => client.close())
    await client.connectWithTransport(clientTransport)

    const boom = client.tools().find((t) => t.name === "boom")!
    await expect(boom.execute({}, ctx())).rejects.toThrow(/intentional failure/)
  })

  test("name prefix avoids collisions across multiple servers", async () => {
    const { clientTransport } = await spinUpEchoServer()
    const client = new MCPClient(
      { kind: "stdio", command: "ignored" },
      { prefix: "test_" },
    )
    cleanup.push(() => client.close())
    await client.connectWithTransport(clientTransport)

    const names = client.tools().map((t) => t.name).sort()
    expect(names).toEqual(["test_boom", "test_echo"])
  })

  test("permission option applies to all wrapped tools", async () => {
    const { clientTransport } = await spinUpEchoServer()
    const client = new MCPClient(
      { kind: "stdio", command: "ignored" },
      { permission: "auto" },
    )
    cleanup.push(() => client.close())
    await client.connectWithTransport(clientTransport)

    for (const t of client.tools()) {
      expect(t.permission).toBe("auto")
    }
  })

  test("close cleans up transport", async () => {
    const { clientTransport } = await spinUpEchoServer()
    const client = new MCPClient({ kind: "stdio", command: "ignored" })
    await client.connectWithTransport(clientTransport)
    expect(client.isConnected()).toBe(true)
    await client.close()
    expect(client.isConnected()).toBe(false)
  })
})
