import { useApp } from "@/store/app"
import { cn, formatTokens } from "@/lib/utils"

export function StatusBar() {
  const conn = useApp((s) => s.conn)
  const version = useApp((s) => s.version)
  const activeSessionId = useApp((s) => s.activeSessionId)
  const runtime = useApp((s) => (activeSessionId ? s.runtimes[activeSessionId] : null))
  const session = useApp((s) => {
    const id = s.activeSessionId
    if (!id) return undefined
    const pid = s.activeProjectId
    return pid ? s.sessionsByProject[pid]?.find((x) => x.id === id) : undefined
  })

  const connLabel = conn === "open" ? "Connected" : conn === "connecting" ? "Connecting…" : "Offline"
  const usage = runtime?.usage ?? session?.usage

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-sidebar/60 px-3 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "size-1.5 rounded-full",
            conn === "open" ? "bg-success" : conn === "connecting" ? "bg-warning" : "bg-destructive",
          )}
        />
        <span>{connLabel}</span>
      </div>

      {session && (
        <>
          <span className="text-muted-foreground/40">|</span>
          <span className="font-mono">{session.modelId}</span>
        </>
      )}

      {usage && usage.totalTokens > 0 && (
        <>
          <span className="text-muted-foreground/40">|</span>
          <span>
            {formatTokens(usage.totalTokens)} tokens
            {usage.costUsd ? ` · $${usage.costUsd.toFixed(4)}` : ""}
          </span>
        </>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        {runtime?.running && (
          <>
            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            <span>Running…</span>
            <span className="text-muted-foreground/40">|</span>
          </>
        )}
        <span>Omni {version && `v${version}`}</span>
      </div>
    </footer>
  )
}
