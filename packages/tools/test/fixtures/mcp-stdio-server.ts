#!/usr/bin/env bun
/**
 * Minimal MCP server used by tests. Listens on stdio.
 * Exposes one tool, `ping`, that returns "pong" plus a value from args.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

const server = new McpServer({ name: "stdio-test", version: "0.0.0" })

server.registerTool(
  "ping",
  {
    title: "Ping",
    description: "Returns 'pong: <value>'",
    inputSchema: { value: z.string() },
  },
  async ({ value }) => ({ content: [{ type: "text", text: `pong: ${value}` }] }),
)

await server.connect(new StdioServerTransport())
