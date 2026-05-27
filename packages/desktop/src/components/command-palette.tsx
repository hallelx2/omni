import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  FolderOpen,
  Plus,
  Settings,
  Sun,
  Moon,
  GitBranch,
  Files,
  MessageSquare,
  FolderGit2,
} from "lucide-react"
import { useApp } from "@/store/app"
import type { SessionSummary } from "@/lib/protocol"

const NO_SESSIONS: SessionSummary[] = []

export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen)
  const setOpen = useApp((s) => s.setPaletteOpen)
  const projects = useApp((s) => s.projects)
  const activeProjectId = useApp((s) => s.activeProjectId)
  const sessions =
    useApp((s) => (s.activeProjectId ? s.sessionsByProject[s.activeProjectId] : undefined)) ?? NO_SESSIONS
  const theme = useApp((s) => s.theme)
  const store = useApp

  function run(fn: () => void) {
    setOpen(false)
    setTimeout(fn, 0)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(() => store.getState().setAddProjectOpen(true))}>
            <FolderOpen /> Open project…
          </CommandItem>
          <CommandItem
            onSelect={() => run(() => store.getState().newSession())}
            disabled={!activeProjectId}
          >
            <Plus /> New session
          </CommandItem>
          <CommandItem onSelect={() => run(() => store.getState().setSettingsOpen(true))}>
            <Settings /> Open settings
          </CommandItem>
          <CommandItem
            onSelect={() => run(() => store.getState().setTheme(theme === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? <Sun /> : <Moon />} Toggle theme
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => store.getState().setRightPanel(store.getState().rightPanel === "git" ? "none" : "git"))
            }
          >
            <GitBranch /> Toggle source control
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() => store.getState().setRightPanel(store.getState().rightPanel === "files" ? "none" : "files"))
            }
          >
            <Files /> Toggle file explorer
          </CommandItem>
        </CommandGroup>

        {projects.length > 0 && (
          <CommandGroup heading="Projects">
            {projects.map((p) => (
              <CommandItem
                key={p.id}
                value={`project ${p.name} ${p.path}`}
                onSelect={() => run(() => store.getState().setActiveProject(p.id))}
              >
                <FolderGit2 /> {p.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {sessions.length > 0 && (
          <CommandGroup heading="Sessions">
            {sessions.map((s) => (
              <CommandItem
                key={s.id}
                value={`session ${s.title} ${s.id}`}
                onSelect={() => run(() => store.getState().openSession(s.id))}
              >
                <MessageSquare /> {s.title || "Untitled"}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
