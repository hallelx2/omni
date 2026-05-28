import { create } from "zustand"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { socket } from "@/lib/ws"
import type { ConnStatus } from "@/lib/ws"
import type {
  Project,
  ProviderInfo,
  SessionSummary,
  OmniConfig,
  OmniPaths,
  PermissionDecision,
  ServerMessage,
  ToolCall,
} from "@/lib/protocol"
import { emptySession, foldEvent, pushUser, messagesToTimeline, type SessionState } from "./timeline"

export type Theme = "dark" | "light"
export type RightPanel = "none" | "git" | "files"

export interface PendingPermission {
  requestId: string
  tool: { name: string; description: string }
  call: ToolCall
}

interface AppState {
  ready: boolean
  version: string
  paths: OmniPaths | null
  conn: ConnStatus
  theme: Theme

  projects: Project[]
  activeProjectId: string | null
  providers: ProviderInfo[]
  config: OmniConfig

  sessionsByProject: Record<string, SessionSummary[]>
  activeSessionId: string | null
  runtimes: Record<string, SessionState>
  pending: Record<string, PendingPermission[]>

  rightPanel: RightPanel
  settingsOpen: boolean
  paletteOpen: boolean
  addProjectOpen: boolean
  sessionPanelCollapsed: boolean

  // lifecycle
  init: () => Promise<void>
  setTheme: (t: Theme) => void

  // projects
  addProject: (path: string) => Promise<Project | null>
  removeProject: (id: string) => Promise<void>
  setActiveProject: (id: string) => Promise<void>
  setProjectModel: (id: string, modelRef: string | undefined) => Promise<void>

  // sessions
  loadSessions: (projectId: string) => Promise<void>
  newSession: (projectId?: string) => Promise<void>
  openSession: (id: string) => Promise<void>
  /** Open a session that may belong to a non-active project (rail flyout). */
  openProjectSession: (projectId: string, sessionId: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>

  // chat
  sendInput: (text: string) => void
  abort: (sessionId: string) => void
  respondPermission: (sessionId: string, requestId: string, decision: PermissionDecision) => void

  // config
  saveConfig: (config: OmniConfig, opts?: { silent?: boolean }) => Promise<boolean>
  refresh: () => Promise<void>

  // ui
  setRightPanel: (p: RightPanel) => void
  setSettingsOpen: (o: boolean) => void
  setPaletteOpen: (o: boolean) => void
  setAddProjectOpen: (o: boolean) => void
  toggleSessionPanel: () => void

  // internal
  _onServer: (msg: ServerMessage) => void
  activeSessions: () => SessionSummary[]
  activeRuntime: () => SessionState | null
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.classList.toggle("dark", theme === "dark")
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  version: "",
  paths: null,
  conn: "connecting",
  theme: "dark",

  projects: [],
  activeProjectId: null,
  providers: [],
  config: {},

  sessionsByProject: {},
  activeSessionId: null,
  runtimes: {},
  pending: {},

  rightPanel: "none",
  settingsOpen: false,
  paletteOpen: false,
  addProjectOpen: false,
  sessionPanelCollapsed: false,

  init: async () => {
    socket.onStatus((conn) => set({ conn }))
    socket.onMessage((msg) => get()._onServer(msg))
    try {
      const boot = await api.bootstrap()
      const theme: Theme = boot.config.ui?.theme === "light" ? "light" : "dark"
      applyTheme(theme)
      set({
        ready: true,
        version: boot.version,
        paths: boot.paths,
        projects: boot.projects,
        providers: boot.providers,
        config: boot.config,
        theme,
        activeProjectId: boot.projects[0]?.id ?? null,
      })
      void socket.connect()
      if (boot.projects[0]) await get().loadSessions(boot.projects[0].id)
    } catch (e) {
      set({ ready: true })
      toast.error("Could not reach the Omni server", { description: (e as Error).message })
    }
  },

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
    const config = { ...get().config, ui: { ...get().config.ui, theme } }
    set({ config })
    void api.saveConfig(config).catch(() => {})
  },

  addProject: async (path) => {
    try {
      const project = await api.addProject(path)
      const projects = [project, ...get().projects.filter((p) => p.id !== project.id)]
      set({ projects })
      await get().setActiveProject(project.id)
      toast.success(`Opened ${project.name}`)
      return project
    } catch (e) {
      toast.error("Couldn't open folder", { description: (e as Error).message })
      return null
    }
  },

  removeProject: async (id) => {
    await api.removeProject(id)
    const projects = get().projects.filter((p) => p.id !== id)
    const activeProjectId = get().activeProjectId === id ? (projects[0]?.id ?? null) : get().activeProjectId
    set({ projects, activeProjectId, activeSessionId: null })
    if (activeProjectId) await get().loadSessions(activeProjectId)
  },

  setActiveProject: async (id) => {
    set({ activeProjectId: id, activeSessionId: null })
    await get().loadSessions(id)
  },

  setProjectModel: async (id, modelRef) => {
    const updated = await api.updateProject(id, { modelRef })
    set({ projects: get().projects.map((p) => (p.id === id ? updated : p)) })
  },

  loadSessions: async (projectId) => {
    try {
      const sessions = await api.listSessions(projectId)
      set({ sessionsByProject: { ...get().sessionsByProject, [projectId]: sessions } })
      if (!get().activeSessionId && sessions[0]) await get().openSession(sessions[0].id)
    } catch (e) {
      toast.error("Failed to load sessions", { description: (e as Error).message })
    }
  },

  newSession: async (projectId) => {
    const pid = projectId ?? get().activeProjectId
    if (!pid) return
    try {
      const session = await api.createSession(pid)
      const list = [session, ...(get().sessionsByProject[pid] ?? [])]
      set({
        sessionsByProject: { ...get().sessionsByProject, [pid]: list },
        activeProjectId: pid,
        activeSessionId: session.id,
        runtimes: { ...get().runtimes, [session.id]: { ...emptySession(), loaded: true } },
      })
    } catch (e) {
      toast.error("Couldn't create session", { description: (e as Error).message })
    }
  },

  openSession: async (id) => {
    set({ activeSessionId: id })
    const existing = get().runtimes[id]
    if (existing?.loaded) return
    try {
      const detail = await api.sessionDetail(id)
      const rt: SessionState = {
        ...emptySession(),
        loaded: true,
        usage: detail.session.usage,
        timeline: messagesToTimeline(detail.messages),
      }
      set({ runtimes: { ...get().runtimes, [id]: rt } })
    } catch (e) {
      set({ runtimes: { ...get().runtimes, [id]: { ...emptySession(), loaded: true } } })
      toast.error("Couldn't open session", { description: (e as Error).message })
    }
  },

  openProjectSession: async (projectId, sessionId) => {
    if (get().activeProjectId !== projectId) {
      set({ activeProjectId: projectId })
      if (!get().sessionsByProject[projectId]) await get().loadSessions(projectId)
    }
    await get().openSession(sessionId)
  },

  deleteSession: async (id) => {
    await api.deleteSession(id)
    const pid = get().activeProjectId
    const runtimes = { ...get().runtimes }
    delete runtimes[id]
    let activeSessionId = get().activeSessionId
    let sessionsByProject = get().sessionsByProject
    if (pid) {
      const list = (sessionsByProject[pid] ?? []).filter((s) => s.id !== id)
      sessionsByProject = { ...sessionsByProject, [pid]: list }
      if (activeSessionId === id) activeSessionId = list[0]?.id ?? null
    }
    set({ runtimes, activeSessionId, sessionsByProject })
    if (activeSessionId) await get().openSession(activeSessionId)
  },

  renameSession: async (id, title) => {
    await api.renameSession(id, title)
    const pid = get().activeProjectId
    if (!pid) return
    const list = (get().sessionsByProject[pid] ?? []).map((s) => (s.id === id ? { ...s, title } : s))
    set({ sessionsByProject: { ...get().sessionsByProject, [pid]: list } })
  },

  sendInput: (text) => {
    const sessionId = get().activeSessionId
    if (!sessionId || !text.trim()) return
    const rt = get().runtimes[sessionId] ?? emptySession()
    set({ runtimes: { ...get().runtimes, [sessionId]: pushUser(rt, text) } })
    socket.send({ type: "run", sessionId, input: text })
    // No optimistic title — the server streams a generated one via "title" messages
    // (empty string first → "Naming…" shimmer in the sidebar).
  },

  abort: (sessionId) => {
    socket.send({ type: "abort", sessionId })
  },

  respondPermission: (sessionId, requestId, decision) => {
    socket.send({ type: "permission_response", requestId, decision })
    const pendingList = (get().pending[sessionId] ?? []).filter((p) => p.requestId !== requestId)
    set({ pending: { ...get().pending, [sessionId]: pendingList } })
  },

  saveConfig: async (config, opts) => {
    const res = await api.saveConfig(config)
    if (res.ok) {
      set({ config })
      const providers = await api.providers().catch(() => get().providers)
      set({ providers })
      if (!opts?.silent) toast.success("Settings saved")
      return true
    }
    toast.error(res.error ?? "Invalid settings", { description: res.issues?.join("\n") })
    return false
  },

  refresh: async () => {
    const [projects, providers] = await Promise.all([api.listProjects(), api.providers()])
    set({ projects, providers })
  },

  setRightPanel: (rightPanel) => set({ rightPanel }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setAddProjectOpen: (addProjectOpen) => set({ addProjectOpen }),
  toggleSessionPanel: () => set({ sessionPanelCollapsed: !get().sessionPanelCollapsed }),

  _onServer: (msg) => {
    if (msg.type === "event") {
      const { sessionId, event } = msg
      const prev = get().runtimes[sessionId] ?? emptySession()
      const next = foldEvent(prev, event)
      set({ runtimes: { ...get().runtimes, [sessionId]: next } })
      // Keep the session summary's usage fresh in the sidebar.
      if (event.type === "engine.usage" || event.type === "engine.done") {
        const pid = get().activeProjectId
        if (pid) {
          const list = (get().sessionsByProject[pid] ?? []).map((s) =>
            s.id === sessionId ? { ...s, usage: next.usage, updatedAt: Date.now() } : s,
          )
          set({ sessionsByProject: { ...get().sessionsByProject, [pid]: list } })
        }
      }
    } else if (msg.type === "permission_request") {
      const list = [...(get().pending[msg.sessionId] ?? []), { requestId: msg.requestId, tool: msg.tool, call: msg.call }]
      set({ pending: { ...get().pending, [msg.sessionId]: list } })
    } else if (msg.type === "title") {
      const sbp = { ...get().sessionsByProject }
      for (const pid of Object.keys(sbp)) {
        const list = sbp[pid]
        if (!list?.some((s) => s.id === msg.sessionId)) continue
        sbp[pid] = list.map((s) => (s.id === msg.sessionId ? { ...s, title: msg.title } : s))
      }
      set({ sessionsByProject: sbp })
    } else if (msg.type === "error") {
      if (msg.sessionId) {
        const prev = get().runtimes[msg.sessionId] ?? emptySession()
        set({
          runtimes: {
            ...get().runtimes,
            [msg.sessionId]: foldEvent(prev, { type: "engine.error", error: { message: msg.message }, fatal: true }),
          },
        })
      }
      toast.error("Run error", { description: msg.message })
    }
  },

  activeSessions: () => {
    const pid = get().activeProjectId
    return pid ? (get().sessionsByProject[pid] ?? []) : []
  },

  activeRuntime: () => {
    const id = get().activeSessionId
    return id ? (get().runtimes[id] ?? null) : null
  },
}))
