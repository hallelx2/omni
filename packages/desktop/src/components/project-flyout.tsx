import { SquarePen, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"
import type { SessionSummary } from "@/lib/protocol"

const NO_SESSIONS: SessionSummary[] = []

/**
 * Floating preview of a project's sessions, shown when hovering its icon in the
 * rail (opencode's HoverCard pattern). Lightweight: open a session, start a new
 * one, or "View all" to expand the project inline. Positioned by the rail.
 */
export function ProjectFlyout({
  projectId,
  top,
  left,
  onEnter,
  onLeave,
}: {
  projectId: string
  top: number
  left: number
  onEnter: () => void
  onLeave: () => void
}) {
  const project = useApp((s) => s.projects.find((p) => p.id === projectId))
  const sessions = useApp((s) => s.sessionsByProject[projectId]) ?? NO_SESSIONS
  const activeSessionId = useApp((s) => s.activeSessionId)
  const collapsed = useApp((s) => s.sessionPanelCollapsed)
  const openProjectSession = useApp((s) => s.openProjectSession)
  const newSession = useApp((s) => s.newSession)
  const setActiveProject = useApp((s) => s.setActiveProject)
  const toggleSessionPanel = useApp((s) => s.toggleSessionPanel)

  if (!project) return null

  const expand = () => {
    void setActiveProject(projectId)
    if (collapsed) toggleSessionPanel()
    onLeave()
  }

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ top, left }}
      className="reveal fixed z-40 flex max-h-[70vh] w-64 flex-col overflow-hidden rounded-xl border border-sidebar-border bg-sidebar shadow-pop"
    >
      <div className="flex items-center justify-between gap-2 border-b border-sidebar-border px-3 py-2">
        <button onClick={expand} className="min-w-0 text-left" title={project.path}>
          <h3 className="truncate text-sm font-semibold transition-colors hover:text-primary">
            {project.name}
          </h3>
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="New session"
          className="-mr-1 shrink-0"
          onClick={() => {
            void newSession(projectId)
            onLeave()
          }}
        >
          <SquarePen className="size-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-0.5 p-2">
          {sessions.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">No sessions yet.</p>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  void openProjectSession(projectId, s.id)
                  onLeave()
                }}
                className={cn(
                  "tactile group flex items-center gap-2 rounded-md px-3 py-1.5 text-left",
                  s.id === activeSessionId ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                {s.title ? (
                  <span className="min-w-0 flex-1 truncate text-[13px]">{s.title}</span>
                ) : (
                  <span className="shimmer min-w-0 flex-1 truncate text-[13px]">Naming…</span>
                )}
                {s.status === "active" && (
                  <span className="size-1.5 shrink-0 rounded-full bg-success" />
                )}
              </button>
            ))
          )}
        </div>
      </ScrollArea>

      <button
        onClick={expand}
        className="flex items-center justify-between border-t border-sidebar-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        View all sessions <ArrowRight className="size-3.5" />
      </button>
    </div>
  )
}
