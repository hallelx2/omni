/**
 * `DesktopServer` — HTTP (REST) + WebSocket surface for the Omni desktop app.
 *
 * REST under `/api` is request/response CRUD (projects, sessions, config,
 * providers, git, files). The single `/ws` socket multiplexes live engine runs
 * and interactive permission prompts for every session. Binds to loopback by
 * default; an optional bearer token guards both channels.
 */
import type { Server, ServerWebSocket } from "bun"
import { URL } from "node:url"
import { ConfigSchema, saveConfig, safeStringify, omniConfigPath, omniPaths, type Config } from "@omni/core"
import { SessionRuntime } from "./runtime.ts"
import { providerRegistry, defaultModelRef } from "./providers.ts"
import { gitStatus, gitDiff } from "./git.ts"
import { fileTree, readProjectFile } from "./files.ts"
import type {
  BootstrapResponse,
  ClientMessage,
  ServerMessage,
  ConfigSaveResult,
} from "./protocol.ts"

const VERSION = "0.1.0"

export interface DesktopServerOptions {
  readonly port?: number
  readonly hostname?: string
  readonly authToken?: string
  readonly runtime?: SessionRuntime
}

interface SocketData {
  send: (msg: ServerMessage) => void
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  })
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status)
}

export class DesktopServer {
  private _server: Server | null = null
  readonly runtime: SessionRuntime

  constructor(private readonly options: DesktopServerOptions = {}) {
    this.runtime = options.runtime ?? new SessionRuntime()
  }

  async start(): Promise<{ port: number; hostname: string }> {
    await this.runtime.init()
    const token = this.options.authToken
    const runtime = this.runtime

    this._server = Bun.serve<SocketData>({
      port: this.options.port ?? 8137,
      hostname: this.options.hostname ?? "127.0.0.1",
      idleTimeout: 0,
      fetch: async (req, srv) => {
        const url = new URL(req.url)

        if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })

        // Auth (header or ?token= for WS, which can't set headers).
        if (token) {
          const bearer = req.headers.get("authorization")
          const qToken = url.searchParams.get("token")
          if (bearer !== `Bearer ${token}` && qToken !== token) {
            return err("unauthorized", 401)
          }
        }

        if (url.pathname === "/health") return new Response("ok", { headers: CORS })

        if (url.pathname === "/ws") {
          const ok = srv.upgrade(req, { data: { send: () => {} } as SocketData })
          return ok ? undefined : err("expected websocket", 426)
        }

        if (url.pathname.startsWith("/api/")) {
          try {
            return await this.handleApi(req, url)
          } catch (e) {
            return err((e as Error).message, 500)
          }
        }

        return err("not found", 404)
      },
      websocket: {
        idleTimeout: 0,
        open: (ws: ServerWebSocket<SocketData>) => {
          ws.data.send = (msg) => {
            // safeStringify: engine events can carry ClassifiedError.cause with
            // circular refs; plain JSON.stringify throws on those.
            if (ws.readyState === 1) ws.send(safeStringify(msg))
          }
          ws.data.send({ type: "ready", serverVersion: VERSION })
        },
        message: (ws: ServerWebSocket<SocketData>, raw) => {
          let msg: ClientMessage
          try {
            msg = JSON.parse(String(raw)) as ClientMessage
          } catch {
            ws.data.send({ type: "error", sessionId: null, message: "invalid JSON" })
            return
          }
          if (msg.type === "run") {
            // Fire-and-forget: awaiting here would block abort/permission replies
            // arriving on the same socket. run() reports its own errors.
            void runtime.run(msg.sessionId, msg.input, ws.data.send)
          } else if (msg.type === "abort") {
            runtime.abort(msg.sessionId)
          } else if (msg.type === "permission_response") {
            runtime.respondPermission(msg.requestId, msg.decision)
          }
        },
        close: (ws: ServerWebSocket<SocketData>) => {
          runtime.detach(ws.data.send)
        },
      },
    })

    return { port: this._server.port, hostname: this._server.hostname }
  }

  async stop(): Promise<void> {
    this._server?.stop()
    this._server = null
    await this.runtime.dispose()
  }

  // ── REST router ───────────────────────────────────────────────────────────

  private async handleApi(req: Request, url: URL): Promise<Response> {
    const { pathname } = url
    const method = req.method
    const rt = this.runtime
    const seg = pathname.split("/").filter(Boolean) // ["api", ...]

    // GET /api/bootstrap
    if (pathname === "/api/bootstrap" && method === "GET") {
      const config = rt.config()
      const body: BootstrapResponse = {
        version: VERSION,
        paths: omniPaths(),
        projects: rt.projects.list(),
        config,
        providers: providerRegistry(config),
        activeModel: defaultModelRef(config),
      }
      return json(body)
    }

    // /api/projects
    if (pathname === "/api/projects") {
      if (method === "GET") return json(rt.projects.list())
      if (method === "POST") {
        const { path } = (await req.json().catch(() => ({}))) as { path?: string }
        if (!path) return err("missing 'path'")
        try {
          return json(rt.projects.add(path), 201)
        } catch (e) {
          return err((e as Error).message)
        }
      }
    }

    // /api/projects/:id  and  /api/projects/:id/sessions
    if (seg[0] === "api" && seg[1] === "projects" && seg[2]) {
      const projectId = seg[2]
      if (!seg[3]) {
        if (method === "DELETE") return json({ ok: rt.projects.remove(projectId) })
        if (method === "PATCH") {
          const patch = (await req.json().catch(() => ({}))) as Record<string, unknown>
          const updated = rt.projects.update(projectId, patch)
          if (!updated) return err("unknown project", 404)
          rt.evictProject(projectId)
          return json(updated)
        }
      }
      if (seg[3] === "sessions" && !seg[4]) {
        if (method === "GET") return json(rt.listSessions(projectId))
        if (method === "POST") {
          const { title } = (await req.json().catch(() => ({}))) as { title?: string }
          try {
            return json(rt.createSession(projectId, title), 201)
          } catch (e) {
            return err((e as Error).message)
          }
        }
      }
    }

    // /api/sessions/:id
    if (seg[0] === "api" && seg[1] === "sessions" && seg[2] && !seg[3]) {
      const id = seg[2]
      if (method === "GET") {
        const detail = rt.getSessionDetail(id)
        return detail ? json(detail) : err("unknown session", 404)
      }
      if (method === "DELETE") return json({ ok: rt.deleteSession(id) })
      if (method === "PATCH") {
        const { title } = (await req.json().catch(() => ({}))) as { title?: string }
        if (typeof title !== "string") return err("missing 'title'")
        return json({ ok: rt.renameSession(id, title) })
      }
    }

    // /api/config
    if (pathname === "/api/config") {
      if (method === "GET") return json({ config: rt.config() })
      if (method === "PUT") {
        const body = (await req.json().catch(() => null)) as { config?: unknown } | null
        const parsed = ConfigSchema.safeParse(body?.config)
        if (!parsed.success) {
          const issues = parsed.error.issues.map(
            (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
          )
          return json({ ok: false, error: "invalid config", issues } satisfies ConfigSaveResult, 400)
        }
        saveConfig(parsed.data as Config, omniConfigPath())
        rt.reloadConfig()
        return json({ ok: true } satisfies ConfigSaveResult)
      }
    }

    // /api/providers
    if (pathname === "/api/providers" && method === "GET") {
      return json(providerRegistry(rt.config()))
    }

    // /api/git/status , /api/git/diff
    if (pathname === "/api/git/status" && method === "GET") {
      const root = this.projectPath(url)
      if (!root) return err("unknown project", 404)
      return json(await gitStatus(root))
    }
    if (pathname === "/api/git/diff" && method === "GET") {
      const root = this.projectPath(url)
      if (!root) return err("unknown project", 404)
      const path = url.searchParams.get("path")
      if (!path) return err("missing 'path'")
      const staged = url.searchParams.get("staged") === "true"
      return json(await gitDiff(root, path, staged))
    }

    // /api/files/tree , /api/files/read
    if (pathname === "/api/files/tree" && method === "GET") {
      const root = this.projectPath(url)
      if (!root) return err("unknown project", 404)
      return json(fileTree(root, url.searchParams.get("dir") ?? ""))
    }
    if (pathname === "/api/files/read" && method === "GET") {
      const root = this.projectPath(url)
      if (!root) return err("unknown project", 404)
      const path = url.searchParams.get("path")
      if (!path) return err("missing 'path'")
      return json(readProjectFile(root, path))
    }

    return err("not found", 404)
  }

  private projectPath(url: URL): string | null {
    const id = url.searchParams.get("projectId")
    if (!id) return null
    return this.runtime.projects.get(id)?.path ?? null
  }
}
