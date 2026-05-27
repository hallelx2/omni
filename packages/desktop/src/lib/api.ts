/** Typed REST client for the desktop server. */
import type {
  BootstrapResponse,
  Project,
  SessionSummary,
  ChatMessage,
  ProviderInfo,
  GitStatus,
  GitDiff,
  FileTree,
  FileContent,
  OmniConfig,
  ConfigSaveResult,
} from "./protocol"
import { getServerInfo, type ServerInfo } from "./tauri"

let info: ServerInfo | null = null

async function server(): Promise<ServerInfo> {
  if (!info) info = await getServerInfo()
  return info
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const s = await server()
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (s.token) headers.Authorization = `Bearer ${s.token}`
  const res = await fetch(s.baseUrl + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let detail = ""
    try {
      const j = (await res.json()) as { error?: string; issues?: string[] }
      detail = j.error ?? (j.issues ? j.issues.join("; ") : "")
    } catch {
      detail = await res.text().catch(() => "")
    }
    throw new ApiError(detail || `${method} ${path} → ${res.status}`, res.status)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

export const api = {
  serverInfo: server,

  bootstrap: () => req<BootstrapResponse>("GET", "/api/bootstrap"),

  // Projects
  listProjects: () => req<Project[]>("GET", "/api/projects"),
  addProject: (path: string) => req<Project>("POST", "/api/projects", { path }),
  updateProject: (id: string, patch: Partial<Pick<Project, "name" | "modelRef" | "mode">>) =>
    req<Project>("PATCH", `/api/projects/${id}`, patch),
  removeProject: (id: string) => req<{ ok: boolean }>("DELETE", `/api/projects/${id}`),

  // Sessions
  listSessions: (projectId: string) =>
    req<SessionSummary[]>("GET", `/api/projects/${projectId}/sessions`),
  createSession: (projectId: string, title?: string) =>
    req<SessionSummary>("POST", `/api/projects/${projectId}/sessions`, { title }),
  sessionDetail: (id: string) =>
    req<{ session: SessionSummary; messages: ChatMessage[] }>("GET", `/api/sessions/${id}`),
  renameSession: (id: string, title: string) =>
    req<{ ok: boolean }>("PATCH", `/api/sessions/${id}`, { title }),
  deleteSession: (id: string) => req<{ ok: boolean }>("DELETE", `/api/sessions/${id}`),

  // Config + providers
  getConfig: () => req<{ config: OmniConfig }>("GET", "/api/config"),
  saveConfig: (config: OmniConfig) => req<ConfigSaveResult>("PUT", "/api/config", { config }),
  providers: () => req<ProviderInfo[]>("GET", "/api/providers"),

  // Git
  gitStatus: (projectId: string) =>
    req<GitStatus>("GET", `/api/git/status?projectId=${encodeURIComponent(projectId)}`),
  gitDiff: (projectId: string, path: string, staged = false) =>
    req<GitDiff>(
      "GET",
      `/api/git/diff?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}&staged=${staged}`,
    ),

  // Files
  fileTree: (projectId: string, dir = "") =>
    req<FileTree>(
      "GET",
      `/api/files/tree?projectId=${encodeURIComponent(projectId)}&dir=${encodeURIComponent(dir)}`,
    ),
  readFile: (projectId: string, path: string) =>
    req<FileContent>(
      "GET",
      `/api/files/read?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`,
    ),
}
