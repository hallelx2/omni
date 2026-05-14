import { z } from "zod"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { Tool, ToolContext } from "@omni/core"

export interface StdioMCPConfig {
  readonly kind: "stdio"
  readonly command: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
}

export interface HTTPMCPConfig {
  readonly kind: "http"
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
}

export type MCPClientConfig = StdioMCPConfig | HTTPMCPConfig

/**
 * Wrapper around the Model Context Protocol SDK that exposes a remote
 * server's tools as Omni `Tool` objects. The client owns the transport,
 * caches the tool list, and forwards `execute()` calls back to the server.
 *
 * Lifecycle:
 *   const c = new MCPClient({ kind: "stdio", command: "uvx", args: ["mcp-server-fetch"] })
 *   await c.connect()
 *   const tools = c.tools()       // pass to Engine.config.tools
 *   ...
 *   await c.close()
 */
export class MCPClient {
  private readonly _client: Client
  private _transport: Transport | undefined
  private _tools: Tool[] = []
  private _connected = false

  constructor(
    private readonly config: MCPClientConfig,
    private readonly options: {
      readonly name?: string
      readonly version?: string
      /** Permission applied to every wrapped tool. Default: "ask". */
      readonly permission?: "auto" | "ask" | "deny"
      /** Prefix tool names to avoid collisions across servers (e.g. "fs_"). */
      readonly prefix?: string
    } = {},
  ) {
    this._client = new Client({
      name: options.name ?? "omni",
      version: options.version ?? "0.0.0",
    })
  }

  /** Connect to the server and discover tools. */
  async connect(): Promise<void> {
    if (this._connected) return
    this._transport = await this._makeTransport()
    await this._client.connect(this._transport)
    await this._reloadTools()
    this._connected = true
  }

  /** Reload the tool list (e.g. after a server-side change). */
  async refresh(): Promise<void> {
    if (!this._connected) throw new Error("MCPClient not connected")
    await this._reloadTools()
  }

  /** Omni-shaped tools, ready to register on the Engine. */
  tools(): readonly Tool[] {
    return this._tools
  }

  isConnected(): boolean {
    return this._connected
  }

  /** Close the underlying transport. Safe to call multiple times. */
  async close(): Promise<void> {
    if (!this._connected) return
    try {
      await this._client.close()
    } finally {
      this._connected = false
      this._transport = undefined
    }
  }

  /** Inject a pre-built transport (used by tests with InMemoryTransport). */
  async connectWithTransport(transport: Transport): Promise<void> {
    if (this._connected) return
    this._transport = transport
    await this._client.connect(transport)
    await this._reloadTools()
    this._connected = true
  }

  private async _makeTransport(): Promise<Transport> {
    if (this.config.kind === "stdio") {
      return new StdioClientTransport({
        command: this.config.command,
        args: this.config.args ? [...this.config.args] : [],
        env: this.config.env as Record<string, string> | undefined,
        cwd: this.config.cwd,
      })
    }
    // The SDK declares its URL parameter as the web URL (lib.dom.d.ts) which
    // includes createObjectURL/canParse; we cast through unknown to bridge
    // the node:url vs DOM URL type schism.
    return new StreamableHTTPClientTransport(new URL(this.config.url) as unknown as never, {
      requestInit: this.config.headers ? { headers: { ...this.config.headers } } : undefined,
    })
  }

  private async _reloadTools(): Promise<void> {
    const res = await this._client.listTools()
    const prefix = this.options.prefix ?? ""
    const permission = this.options.permission ?? "ask"
    this._tools = res.tools.map((t) => this._wrapTool(t, prefix, permission))
  }

  private _wrapTool(
    spec: { name: string; description?: string; inputSchema?: unknown },
    prefix: string,
    permission: "auto" | "ask" | "deny",
  ): Tool {
    const fullName = prefix + spec.name
    const client = this._client
    const originalName = spec.name
    return {
      name: fullName,
      description: spec.description ?? "",
      permission,
      // MCP server is the source of truth for arg shape; accept anything,
      // let the server validate, and surface its error if invalid.
      schema: z.any() as z.ZodType<unknown>,
      async execute(args: unknown, _ctx: ToolContext): Promise<unknown> {
        const result = await client.callTool({
          name: originalName,
          arguments: (args ?? {}) as Record<string, unknown>,
        })
        if (result.isError) {
          const text = extractText(result.content)
          throw new Error(text || "MCP tool returned error")
        }
        return extractResult(result.content)
      },
    }
  }
}

interface MCPContentBlock {
  readonly type: string
  readonly text?: string
  readonly data?: string
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ""
  return (content as MCPContentBlock[])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text!)
    .join("\n")
}

function extractResult(content: unknown): unknown {
  if (!Array.isArray(content)) return content
  const blocks = content as MCPContentBlock[]
  // If everything is text, return joined string. Otherwise return blocks verbatim.
  const onlyText = blocks.every((b) => b.type === "text")
  if (onlyText) return blocks.map((b) => b.text ?? "").join("\n")
  return blocks
}
