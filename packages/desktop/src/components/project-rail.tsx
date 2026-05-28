import { useRef, useState } from "react"
import { Plus, Settings } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useApp } from "@/store/app"
import { cn, initials } from "@/lib/utils"
import { ProjectFlyout } from "./project-flyout"

// Grace period so moving the cursor from an icon onto its flyout doesn't close it.
const CLOSE_DELAY_MS = 140

export function ProjectRail() {
  const projects = useApp((s) => s.projects)
  const activeProjectId = useApp((s) => s.activeProjectId)
  const collapsed = useApp((s) => s.sessionPanelCollapsed)
  const setActiveProject = useApp((s) => s.setActiveProject)
  const setAddProjectOpen = useApp((s) => s.setAddProjectOpen)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)
  const toggleSessionPanel = useApp((s) => s.toggleSessionPanel)
  const loadSessions = useApp((s) => s.loadSessions)

  const navRef = useRef<HTMLElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hovered, setHovered] = useState<{ id: string; top: number; left: number } | null>(null)

  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setHovered(null), CLOSE_DELAY_MS)
  }
  const closeNow = () => {
    cancelClose()
    setHovered(null)
  }

  const onEnterProject = (id: string, el: HTMLElement) => {
    cancelClose()
    const rect = el.getBoundingClientRect()
    const left = navRef.current?.getBoundingClientRect().right ?? rect.right
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - 340))
    setHovered({ id, top, left })
    // Sessions load lazily (only for the active project), so fetch on first peek.
    if (!useApp.getState().sessionsByProject[id]) void loadSessions(id)
  }

  const onClickProject = (id: string) => {
    if (id !== activeProjectId) void setActiveProject(id)
    if (collapsed) toggleSessionPanel()
    closeNow()
  }

  // The active project's sessions are already shown inline when expanded — no
  // need to also peek them. Otherwise hovering any project reveals its sessions.
  const showFlyout = hovered && !(!collapsed && hovered.id === activeProjectId)

  return (
    <>
      <nav
        ref={navRef}
        className="flex w-14 shrink-0 flex-col items-center gap-1.5 border-r border-sidebar-border bg-sidebar py-3"
      >
        <div className="flex flex-1 flex-col items-center gap-1.5 overflow-y-auto scrollbar-thin">
          {projects.map((p) => {
            const active = p.id === activeProjectId
            return (
              <button
                key={p.id}
                onClick={() => onClickProject(p.id)}
                onMouseEnter={(e) => onEnterProject(p.id, e.currentTarget)}
                onMouseLeave={scheduleClose}
                className={cn(
                  "tactile relative grid size-10 place-items-center rounded-xl text-xs font-semibold uppercase",
                  active
                    ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                    : "bg-card text-muted-foreground hover:scale-[1.04] hover:bg-accent hover:text-foreground",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute -left-3 h-5 w-1 rounded-r-full bg-primary transition-[opacity,transform] duration-[var(--duration-base)] ease-out",
                    active ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0",
                  )}
                />
                {initials(p.name)}
              </button>
            )
          })}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setAddProjectOpen(true)}
                className="grid size-10 place-items-center rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent hover:text-primary"
              >
                <Plus className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Open project</TooltipContent>
          </Tooltip>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setSettingsOpen(true)}
              className="grid size-10 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Settings className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
      </nav>

      {showFlyout && hovered && (
        <ProjectFlyout
          projectId={hovered.id}
          top={hovered.top}
          left={hovered.left}
          onEnter={cancelClose}
          onLeave={closeNow}
        />
      )}
    </>
  )
}
