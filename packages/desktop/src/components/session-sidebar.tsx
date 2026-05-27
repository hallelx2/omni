import { MoreHorizontal, Plus, Trash2, FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ModelPicker } from "@/components/model-picker"
import { useApp } from "@/store/app"
import { cn, relativeTime } from "@/lib/utils"
import type { SessionSummary } from "@/lib/protocol"

const NO_SESSIONS: SessionSummary[] = []

export function SessionSidebar() {
  const projects = useApp((s) => s.projects)
  const activeProjectId = useApp((s) => s.activeProjectId)
  const project = projects.find((p) => p.id === activeProjectId)
  const sessions =
    useApp((s) => (activeProjectId ? s.sessionsByProject[activeProjectId] : undefined)) ?? NO_SESSIONS
  const activeSessionId = useApp((s) => s.activeSessionId)
  const openSession = useApp((s) => s.openSession)
  const newSession = useApp((s) => s.newSession)
  const deleteSession = useApp((s) => s.deleteSession)
  const removeProject = useApp((s) => s.removeProject)
  const setProjectModel = useApp((s) => s.setProjectModel)

  if (!project) {
    return (
      <aside className="flex w-64 shrink-0 flex-col items-center justify-center gap-3 border-r border-sidebar-border bg-sidebar/40 p-6 text-center">
        <FolderOpen className="size-7 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground text-balance">
          Open a project folder to start a session.
        </p>
      </aside>
    )
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar/40">
      <div className="flex flex-col gap-3 border-b border-sidebar-border p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{project.name}</h2>
            <p className="truncate text-[11px] text-muted-foreground" title={project.path}>
              {project.path}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="-mr-1 shrink-0">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigator.clipboard?.writeText(project.path)}>
                Copy path
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => removeProject(project.id)}>
                Remove project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">Default model</label>
          <ModelPicker
            value={project.modelRef}
            onChange={(ref) => setProjectModel(project.id, ref)}
          />
        </div>

        <Button size="sm" className="w-full" onClick={() => newSession(project.id)}>
          <Plus className="size-4" /> New session
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-0.5 p-2">
          {sessions.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">No sessions yet.</p>
          ) : (
            groupSessions(sessions).map(
              ({ label, list }) =>
                list.length > 0 && (
                  <div key={label}>
                    <div className="px-2 pb-1 pt-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/55">
                      {label}
                    </div>
                    {list.map((s) => (
                      <SessionRow
                        key={s.id}
                        session={s}
                        active={s.id === activeSessionId}
                        onOpen={() => openSession(s.id)}
                        onDelete={() => deleteSession(s.id)}
                      />
                    ))}
                  </div>
                ),
            )
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}

function SessionRow({
  session,
  active,
  onOpen,
  onDelete,
}: {
  session: SessionSummary
  active: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const model = session.modelId.includes(":") ? session.modelId.split(":")[1] : session.modelId
  return (
    <div
      onClick={onOpen}
      title={`${model} · ${relativeTime(session.updatedAt)}`}
      className={cn(
        "tactile group relative cursor-pointer rounded-md px-3 py-1.5 pr-6",
        active ? "bg-accent" : "hover:bg-accent/50",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute bottom-1.5 left-1 top-1.5 w-px origin-center rounded-full bg-foreground transition-[opacity,transform] duration-[var(--duration-base)] ease-out",
          active
            ? "scale-y-100 opacity-100"
            : "scale-y-0 opacity-0 group-hover:scale-y-100 group-hover:opacity-40",
        )}
      />
      <div className="flex items-center gap-2">
        {session.title ? (
          <span className="min-w-0 flex-1 truncate text-[13px]">{session.title}</span>
        ) : (
          <span className="shimmer min-w-0 flex-1 truncate text-[13px]">Naming…</span>
        )}
        {session.status === "active" && (
          <span className="size-1.5 shrink-0 rounded-full bg-success" />
        )}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className="absolute right-1.5 top-1.5 hidden rounded-md p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive group-hover:block"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}

function groupSessions(sessions: readonly SessionSummary[]): { label: string; list: SessionSummary[] }[] {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000
  const startOfWeek = startOfToday - 7 * 24 * 60 * 60 * 1000
  const groups: Record<string, SessionSummary[]> = {
    Today: [],
    Yesterday: [],
    "This Week": [],
    Earlier: [],
  }
  for (const s of sessions) {
    if (s.updatedAt >= startOfToday) groups.Today!.push(s)
    else if (s.updatedAt >= startOfYesterday) groups.Yesterday!.push(s)
    else if (s.updatedAt >= startOfWeek) groups["This Week"]!.push(s)
    else groups.Earlier!.push(s)
  }
  return [
    { label: "Today", list: groups.Today! },
    { label: "Yesterday", list: groups.Yesterday! },
    { label: "This Week", list: groups["This Week"]! },
    { label: "Earlier", list: groups.Earlier! },
  ]
}
