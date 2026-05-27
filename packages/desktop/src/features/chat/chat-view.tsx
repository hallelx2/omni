import { Sparkles, Plus, FolderOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ModelPicker } from "@/components/model-picker"
import { useApp } from "@/store/app"
import type { SessionSummary } from "@/lib/protocol"
import { MessageList } from "./message-list"
import { Composer } from "./composer"
import { PermissionPrompts } from "./permission-prompt"

const NO_SESSIONS: SessionSummary[] = []

export function ChatView() {
  const activeProjectId = useApp((s) => s.activeProjectId)
  const activeSessionId = useApp((s) => s.activeSessionId)
  const runtime = useApp((s) => (activeSessionId ? s.runtimes[activeSessionId] : null))
  const sessions =
    useApp((s) => (activeProjectId ? s.sessionsByProject[activeProjectId] : undefined)) ?? NO_SESSIONS
  const session = sessions.find((s) => s.id === activeSessionId)
  const projects = useApp((s) => s.projects)
  const project = projects.find((p) => p.id === activeProjectId)
  const newSession = useApp((s) => s.newSession)
  const setAddProjectOpen = useApp((s) => s.setAddProjectOpen)
  const setProjectModel = useApp((s) => s.setProjectModel)

  if (!project) {
    return (
      <Hero
        icon={<FolderOpen className="size-7" />}
        title="Welcome to Omni"
        body="A small, fast home for your self-improving agent. Open a project folder to begin."
        action={
          <Button onClick={() => setAddProjectOpen(true)}>
            <FolderOpen className="size-4" /> Open project
          </Button>
        }
      />
    )
  }

  if (!activeSessionId || !session) {
    return (
      <Hero
        icon={<Sparkles className="size-7" />}
        title={`Start in ${project.name}`}
        body="Create a session to chat with the harness, run tools, and edit code in this project."
        action={
          <Button onClick={() => newSession(project.id)}>
            <Plus className="size-4" /> New session
          </Button>
        }
      />
    )
  }

  const items = runtime?.timeline ?? []

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-5">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{session.title || "Untitled session"}</h1>
        <ModelPicker
          value={project.modelRef}
          onChange={(ref) => setProjectModel(project.id, ref)}
          className="w-52"
        />
      </header>

      {items.length === 0 ? (
        <SessionEmpty projectName={project.name} />
      ) : (
        <MessageList
          items={items}
          running={runtime?.running ?? false}
          phase={runtime?.phase ?? "idle"}
          iteration={runtime?.iteration ?? 0}
        />
      )}

      <div className="shrink-0">
        <div className="mb-2">
          <PermissionPrompts sessionId={activeSessionId} />
        </div>
        <Composer running={runtime?.running ?? false} />
      </div>
    </div>
  )
}

function SessionEmpty({ projectName }: { projectName: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <div className="grid size-12 place-items-center rounded-xl bg-foreground text-xl font-bold text-background">
        Ω
      </div>
      <h2 className="mt-2 text-lg font-semibold">How can I help?</h2>
      <p className="max-w-sm text-sm text-muted-foreground text-balance">
        Working in <span className="font-medium text-foreground">{projectName}</span>. Ask a question,
        request a change, or have the agent explore the codebase.
      </p>
    </div>
  )
}

function Hero({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode
  title: string
  body: string
  action: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-card text-muted-foreground shadow-soft ring-1 ring-border">
        {icon}
      </div>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-md text-sm text-muted-foreground text-balance">{body}</p>
      <div className="mt-2">{action}</div>
    </div>
  )
}
