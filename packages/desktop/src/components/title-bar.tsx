import { useEffect, useState } from "react"
import { Search, GitBranch, Files, Sun, Moon, Minus, Square, X, TerminalSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import { useApp } from "@/store/app"
import { useTerminals } from "@/store/terminals"
import { isTauri, windowAction } from "@/lib/tauri"
import { cn } from "@/lib/utils"

export function TitleBar() {
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  const setPaletteOpen = useApp((s) => s.setPaletteOpen)
  const rightPanel = useApp((s) => s.rightPanel)
  const setRightPanel = useApp((s) => s.setRightPanel)
  const projects = useApp((s) => s.projects)
  const activeProjectId = useApp((s) => s.activeProjectId)
  const tauri = isTauri()
  const project = projects.find((p) => p.id === activeProjectId)
  const termOpen = useTerminals((s) => s.open)
  const toggleTerm = useTerminals((s) => s.toggle)

  const togglePanel = (panel: "git" | "files") => setRightPanel(rightPanel === panel ? "none" : panel)

  return (
    <header className="drag-region relative flex h-11 shrink-0 items-center gap-2 border-b border-border bg-sidebar/60 px-3">
      <div className={cn("flex items-center gap-2.5", tauri && "pl-2")}>
        <div className="grid size-6 place-items-center rounded-md bg-foreground text-[12px] font-bold text-background">
          Ω
        </div>
        <span className="text-sm font-semibold tracking-tight">Omni</span>
        {project && (
          <>
            <span className="text-muted-foreground/50">/</span>
            <span className="max-w-44 truncate text-sm text-muted-foreground">{project.name}</span>
          </>
        )}
      </div>

      <div className="no-drag mx-auto">
        <button
          onClick={() => setPaletteOpen(true)}
          className="group flex h-7 w-80 items-center gap-2 rounded-md border border-border-strong bg-background/60 px-2.5 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent/50"
        >
          <Search className="size-3.5" />
          <span>Search projects, sessions, commands…</span>
          <kbd className="ml-auto rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-wider">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="no-drag flex items-center gap-0.5">
        <IconToggle active={rightPanel === "files"} onClick={() => togglePanel("files")} label="Files">
          <Files className="size-4" />
        </IconToggle>
        <IconToggle active={rightPanel === "git"} onClick={() => togglePanel("git")} label="Source control">
          <GitBranch className="size-4" />
        </IconToggle>
        <IconToggle active={termOpen} onClick={() => toggleTerm(project?.path)} label="Terminal (⌘`)">
          <TerminalSquare className="size-4" />
        </IconToggle>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              <span className="relative grid size-4 place-items-center">
                <Sun
                  className={cn(
                    "icon-swap absolute size-4",
                    theme === "dark" ? "rotate-90 opacity-0" : "rotate-0 opacity-100",
                  )}
                />
                <Moon
                  className={cn(
                    "icon-swap absolute size-4",
                    theme === "dark" ? "rotate-0 opacity-100" : "-rotate-90 opacity-0",
                  )}
                />
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle theme</TooltipContent>
        </Tooltip>

        {tauri && (
          <>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <WindowButtons />
          </>
        )}
      </div>
    </header>
  )
}

function IconToggle({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClick}
          className={cn(active && "bg-accent text-accent-foreground")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function WindowButtons() {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    setMaximized(false)
  }, [])
  return (
    <div className="flex items-center">
      <button
        onClick={() => windowAction("minimize")}
        className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent"
      >
        <Minus className="size-3.5" />
      </button>
      <button
        onClick={() => {
          void windowAction("toggleMaximize")
          setMaximized((m) => !m)
        }}
        className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent"
      >
        <Square className="size-3" />
      </button>
      <button
        onClick={() => windowAction("close")}
        className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
