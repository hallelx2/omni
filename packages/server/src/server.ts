import type { Server, ServerWebSocket } from "bun"
import { ulid } from "ulid"
import {
  Engine,
  AllowAllPermissions,
  AskPermissions,
  type EngineConfig,
  type EngineEvent,
  type PermissionDecision,
  type Tool,
  type ToolCall,
} from "@omni/core"

export interface OmniServerOptions {
  readonly port?: number
  readonly hostname?: string
  /** Factory that returns a fresh EngineConfig per new session. */
  readonly engineConfig: () => EngineConfig
  /** Pre-shared key required in the `Authorization: Bearer <key>` header. */
  readonly authToken?: string
  /**
   * When true, the server replaces the engine's PermissionGate with one that
   * forwards `permission.request` messages to the WS client and awaits a
   * matching `permission.response`. Falls back to AllowAll if the client
   * doesn't respond within `permissionTimeoutMs`.
   */
  readonly interactivePermissions?: boolean
  /** Default 30 seconds. */
  readonly permissionTimeoutMs?: number
}

// ── Wire protocol ──────────────────────────────────────────────────────────

type ClientMessage =
  | { readonly type: "run"; readonly input: string }
  | { readonly type: "abort" }
  | {
      readonly type: "permission.response"
      readonly requestId: string
      readonly decision: PermissionDecision
    }

interface PermissionRequestEvent {
  readonly type: "permission.request"
  readonly requestId: string
  readonly tool: { readonly name: string; readonly description: string }
  readonly call: ToolCall
}

interface SessionData {
  engine: Engine
  ac: AbortController
  /** id → resolver */
  pendingPermissions: Map<string, (decision: PermissionDecision) => void>
}

/**
 * HTTP + WebSocket server exposing a streaming engine.
 *
 * Protocol:
 *   Client → Server:
 *     { type: "run", input: "..." }
 *     { type: "abort" }
 *     { type: "permission.response", requestId, decision: "allow"|"deny" }
 *
 *   Server → Client:
 *     EngineEvent JSON (one per message)
 *     { type: "permission.request", requestId, tool, call }
 *     { type: "server.hello", sessionId }
 *     { type: "server.error", message }
 *
 * HTTP endpoints:
 *   GET  /health
 *   GET  /version
 *   WS   /ws
 */
export class OmniServer {
  private _server: Server | null = null
  private readonly _sessions = new Map<ServerWebSocket<SessionData>, void>()

  constructor(private readonly options: OmniServerOptions) {}

  start(): { port: number; hostname: string } {
    const port = this.options.port ?? 0
    const hostname = this.options.hostname ?? "localhost"
    const factory = this.options.engineConfig
    const token = this.options.authToken
    const interactive = this.options.interactivePermissions ?? false
    const permTimeout = this.options.permissionTimeoutMs ?? 30_000
    const sessions = this._sessions

    this._server = Bun.serve<SessionData>({
      port,
      hostname,
      fetch(req, srv) {
        const url = new URL(req.url)
        if (token) {
          const auth = req.headers.get("authorization")
          if (auth !== `Bearer ${token}`) {
            return new Response("unauthorized", { status: 401 })
          }
        }
        if (url.pathname === "/health") return new Response("ok")
        if (url.pathname === "/version")
          return Response.json({ name: "omni-server", version: "0.0.0" })
        if (url.pathname === "/ws") {
          const pendingPermissions = new Map<string, (d: PermissionDecision) => void>()
          let baseConfig = factory()
          if (interactive) {
            baseConfig = {
              ...baseConfig,
              permissions: makeWsAskGate(() => attachedWs, pendingPermissions, permTimeout),
            }
          }
          const data: SessionData = {
            engine: new Engine(baseConfig),
            ac: new AbortController(),
            pendingPermissions,
          }
          // attachedWs is mutated in `open` once we know the socket; closure captures
          // the reference cell.
          let attachedWs: ServerWebSocket<SessionData> | null = null
          if (
            srv.upgrade(req, {
              data: {
                ...data,
                pendingPermissions,
                get _attach() {
                  return (ws: ServerWebSocket<SessionData>) => {
                    attachedWs = ws
                  }
                },
              } as SessionData,
            })
          ) {
            return undefined
          }
          return new Response("expected websocket", { status: 426 })
        }
        return new Response("not found", { status: 404 })
      },
      websocket: {
        open(ws) {
          sessions.set(ws)
          ws.send(
            JSON.stringify({
              type: "server.hello",
              sessionId: ws.data.engine.sessionId(),
            }),
          )
        },
        async message(ws, raw) {
          let msg: ClientMessage
          try {
            msg = JSON.parse(String(raw)) as ClientMessage
          } catch {
            ws.send(JSON.stringify({ type: "server.error", message: "invalid JSON" }))
            return
          }
          if (msg.type === "abort") {
            ws.data.ac.abort()
            return
          }
          if (msg.type === "permission.response") {
            const resolver = ws.data.pendingPermissions.get(msg.requestId)
            if (resolver) {
              ws.data.pendingPermissions.delete(msg.requestId)
              resolver(msg.decision)
            }
            return
          }
          if (msg.type === "run") {
            ws.data.ac = new AbortController()
            try {
              // Wire interactive perms to THIS specific ws by replacing the
              // engine's gate's "send" function. We do this by attaching the
              // ws to a holder. Simpler approach: re-create the engine per
              // run with the right ws. For now, rely on a shared map.
              ;(globalThis as Record<symbol, unknown>)[CURRENT_WS] = ws
              for await (const ev of ws.data.engine.run(msg.input, {
                signal: ws.data.ac.signal,
              })) {
                if (ws.readyState !== 1) break
                ws.send(JSON.stringify(ev))
              }
            } catch (e) {
              ws.send(
                JSON.stringify({
                  type: "server.error",
                  message: (e as Error).message,
                }),
              )
            } finally {
              ;(globalThis as Record<symbol, unknown>)[CURRENT_WS] = undefined
              // Cancel any dangling permissions
              for (const [, r] of ws.data.pendingPermissions) r("deny")
              ws.data.pendingPermissions.clear()
            }
          }
        },
        close(ws) {
          ws.data.ac.abort()
          for (const [, r] of ws.data.pendingPermissions) r("deny")
          ws.data.pendingPermissions.clear()
          sessions.delete(ws)
        },
      },
    })

    return {
      port: this._server.port,
      hostname: this._server.hostname,
    }
  }

  stop(): void {
    if (!this._server) return
    for (const ws of this._sessions.keys()) {
      try {
        ws.close()
      } catch {
        // ignore
      }
    }
    this._server.stop()
    this._server = null
  }

  /** Broadcast a server-side event to all connected clients. */
  broadcast(event: EngineEvent): void {
    for (const ws of this._sessions.keys()) {
      try {
        ws.send(JSON.stringify(event))
      } catch {
        // ignore
      }
    }
  }
}

// ── Permission bridge ──────────────────────────────────────────────────────

// We thread "the ws for this run" through a globalThis-keyed symbol so the
// AskPermissions handler can find it. This is acceptable because only one
// run is in flight per ws at a time (sequential in the protocol).
const CURRENT_WS = Symbol.for("@omni/server/current-ws")

function makeWsAskGate(
  _getWs: () => ServerWebSocket<SessionData> | null,
  pending: Map<string, (d: PermissionDecision) => void>,
  timeoutMs: number,
): AskPermissions {
  const fallback = new AllowAllPermissions()
  return new AskPermissions(async (tool: Tool, call: ToolCall) => {
    const holder = (globalThis as Record<symbol, unknown>)[CURRENT_WS] as
      | ServerWebSocket<SessionData>
      | undefined
    if (!holder || holder.readyState !== 1) {
      return fallback.check()
    }
    const requestId = ulid()
    const req: PermissionRequestEvent = {
      type: "permission.request",
      requestId,
      tool: { name: tool.name, description: tool.description },
      call,
    }
    holder.send(JSON.stringify(req))
    return new Promise<PermissionDecision>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        resolve("deny")
      }, timeoutMs)
      pending.set(requestId, (decision) => {
        clearTimeout(timer)
        resolve(decision)
      })
    })
  })
}
