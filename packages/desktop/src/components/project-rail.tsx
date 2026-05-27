import { Plus, Settings } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useApp } from "@/store/app"
import { cn, initials } from "@/lib/utils"

export function ProjectRail() {
  const projects = useApp((s) => s.projects)
  const activeProjectId = useApp((s) => s.activeProjectId)
  const setActiveProject = useApp((s) => s.setActiveProject)
  const setAddProjectOpen = useApp((s) => s.setAddProjectOpen)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)

  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-1.5 border-r border-sidebar-border bg-sidebar py-3">
      <div className="flex flex-1 flex-col items-center gap-1.5 overflow-y-auto scrollbar-thin">
        {projects.map((p) => {
          const active = p.id === activeProjectId
          return (
            <Tooltip key={p.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setActiveProject(p.id)}
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
              </TooltipTrigger>
              <TooltipContent side="right">{p.name}</TooltipContent>
            </Tooltip>
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
  )
}
