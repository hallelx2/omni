import { useEffect, useRef } from "react"
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { useApp } from "@/store/app"
import { TitleBar } from "@/components/title-bar"
import { ProjectRail } from "@/components/project-rail"
import { SidebarDock } from "@/components/sidebar-dock"
import { StatusBar } from "@/components/status-bar"
import { CommandPalette } from "@/components/command-palette"
import { AddProjectDialog } from "@/components/add-project-dialog"
import { ChatView } from "@/features/chat/chat-view"
import { SettingsDialog } from "@/features/settings/settings-dialog"
import { GitPanel } from "@/features/git/git-panel"
import { FilesPanel } from "@/features/files/files-panel"
import { TerminalPanel } from "@/features/terminal/terminal-panel"
import { useTerminals } from "@/store/terminals"

export function App() {
  const started = useRef(false)
  const rightPanel = useApp((s) => s.rightPanel)
  const setPaletteOpen = useApp((s) => s.setPaletteOpen)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void useApp.getState().init()
  }, [])

  // Global shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setPaletteOpen(true)
      } else if (mod && e.key === ",") {
        e.preventDefault()
        setSettingsOpen(true)
      } else if (mod && e.key === "`") {
        e.preventDefault()
        const st = useApp.getState()
        const path = st.projects.find((p) => p.id === st.activeProjectId)?.path
        useTerminals.getState().toggle(path)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setPaletteOpen, setSettingsOpen])

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <ProjectRail />
          <SidebarDock />
          <PanelGroup direction="horizontal" className="min-w-0 flex-1">
            <Panel defaultSize={62} minSize={30} className="min-w-0">
              <ChatView />
            </Panel>
            {rightPanel !== "none" && (
              <>
                <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-primary/40 data-[resize-handle-state=drag]:bg-primary/60" />
                <Panel defaultSize={38} minSize={24} className="min-w-0">
                  {rightPanel === "git" ? <GitPanel /> : <FilesPanel />}
                </Panel>
              </>
            )}
          </PanelGroup>
        </div>
        <TerminalPanel />
        <StatusBar />
      </div>
      <CommandPalette />
      <SettingsDialog />
      <AddProjectDialog />
      <Toaster />
    </TooltipProvider>
  )
}
