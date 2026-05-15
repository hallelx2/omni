import { expandEnvDeep, type Config } from "@omni/core"
import type { Tool } from "@omni/core"
import { MCPClient, type MCPClientConfig } from "./mcp.ts"

export type MCPServerStatus = "idle" | "connecting" | "connected" | "failed" | "closed"

export interface MCPServerState {
  readonly name: string
  readonly config: MCPClientConfig
  readonly status: MCPServerStatus
  readonly error?: string
  readonly toolCount?: number
}

/**
 * Manages a fleet of MCP servers declared in config. Connects them in
 * parallel on startup; a single failure doesn't block the others. Exposes
 * their tools as a flat array suitable for {@link EngineConfig.tools}.
 *
 * @example
 * ```ts
 * const manager = new MCPManager(config.mcp?.servers ?? {})
 * await manager.connectAll()
 * const engine = new Engine({ tools: [...builtIns, ...manager.tools()], ... })
 * // later
 * await manager.closeAll()
 * ```
 */
export class MCPManager {
  private readonly _clients = new Map<string, MCPClient>()
  private readonly _state = new Map<string, MCPServerState>()

  constructor(servers: NonNullable<Config["mcp"]>["servers"] = {}) {
    for (const [name, server] of Object.entries(servers ?? {})) {
      const expanded = expandEnvDeep(server)
      const config: MCPClientConfig =
        expanded.kind === "stdio"
          ? {
              kind: "stdio",
              command: expanded.command,
              args: expanded.args,
              env: expanded.env,
              cwd: expanded.cwd,
            }
          : { kind: "http", url: expanded.url, headers: expanded.headers }
      this._state.set(name, { name, config, status: "idle" })
      this._clients.set(
        name,
        new MCPClient(config, {
          permission: expanded.permission,
          prefix: expanded.prefix,
        }),
      )
    }
  }

  /** Connect to every configured server in parallel. Failures don't throw. */
  async connectAll(): Promise<void> {
    await Promise.all(
      [...this._clients.entries()].map(async ([name, client]) => {
        this._update(name, { status: "connecting" })
        try {
          await client.connect()
          this._update(name, {
            status: "connected",
            toolCount: client.tools().length,
          })
        } catch (e) {
          this._update(name, {
            status: "failed",
            error: (e as Error).message,
          })
        }
      }),
    )
  }

  /** Reconnect a single server (closes first if currently connected). */
  async restart(name: string): Promise<void> {
    const client = this._clients.get(name)
    if (!client) throw new Error(`unknown MCP server: ${name}`)
    if (client.isConnected()) await client.close()
    this._update(name, { status: "connecting" })
    try {
      await client.connect()
      this._update(name, {
        status: "connected",
        toolCount: client.tools().length,
      })
    } catch (e) {
      this._update(name, {
        status: "failed",
        error: (e as Error).message,
      })
      throw e
    }
  }

  /** Close every connected server. Safe to call multiple times. */
  async closeAll(): Promise<void> {
    await Promise.all(
      [...this._clients.entries()].map(async ([name, client]) => {
        if (client.isConnected()) {
          await client.close()
          this._update(name, { status: "closed" })
        }
      }),
    )
  }

  /** Flat list of every tool from every connected server. */
  tools(): readonly Tool[] {
    const out: Tool[] = []
    for (const client of this._clients.values()) {
      if (client.isConnected()) out.push(...client.tools())
    }
    return out
  }

  /** Per-server status (connecting/connected/failed/closed) for /mcp commands. */
  status(): readonly MCPServerState[] {
    return [...this._state.values()]
  }

  /** Names of currently-connected servers. */
  connected(): readonly string[] {
    return [...this._state.values()]
      .filter((s) => s.status === "connected")
      .map((s) => s.name)
  }

  private _update(name: string, patch: Partial<MCPServerState>): void {
    const prev = this._state.get(name)
    if (!prev) return
    this._state.set(name, { ...prev, ...patch })
  }
}
