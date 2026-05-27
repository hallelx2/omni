import { useCallback, useEffect, useState } from "react"
import { GitBranch, RefreshCw, ArrowLeft, FileDiff, GitCommitHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DiffView } from "@/components/diff-view"
import { useApp } from "@/store/app"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { GitStatus, GitFile, GitDiff } from "@/lib/protocol"

export function GitPanel() {
  const projectId = useApp((s) => s.activeProjectId)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<{ file: GitFile; diff: GitDiff } | null>(null)

  const refresh = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      setStatus(await api.gitStatus(projectId))
    } catch {
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setSelected(null)
    void refresh()
  }, [refresh])

  async function openDiff(file: GitFile) {
    if (!projectId) return
    const diff = await api.gitDiff(projectId, file.path, file.staged && !file.unstaged)
    setSelected({ file, diff })
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        {selected ? (
          <>
            <Button variant="ghost" size="icon-sm" onClick={() => setSelected(null)}>
              <ArrowLeft className="size-4" />
            </Button>
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{selected.file.path}</span>
          </>
        ) : (
          <>
            <GitBranch className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Source Control</span>
            {status?.branch && (
              <Badge variant="muted" className="font-mono">
                {status.branch}
                {status.ahead ? ` ↑${status.ahead}` : ""}
                {status.behind ? ` ↓${status.behind}` : ""}
              </Badge>
            )}
            <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={refresh} disabled={loading}>
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </Button>
          </>
        )}
      </header>

      {selected ? (
        <GitDiffBody diff={selected.diff} />
      ) : (
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {!status?.isRepo ? (
            <Empty icon={<GitBranch className="size-6" />} text="This folder is not a git repository." />
          ) : status.clean ? (
            <Empty icon={<GitCommitHorizontal className="size-6" />} text="Working tree clean." />
          ) : (
            <div className="p-2">
              <FileGroup
                label="Changes"
                files={status.files}
                onSelect={openDiff}
                selected={null}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  M: { label: "M", cls: "text-warning" },
  A: { label: "A", cls: "text-success" },
  D: { label: "D", cls: "text-destructive" },
  R: { label: "R", cls: "text-primary" },
  "?": { label: "U", cls: "text-success" },
}

function statusChar(f: GitFile): { label: string; cls: string } {
  const c = f.untracked ? "?" : (f.status.trim()[0] ?? "M")
  return STATUS_META[c] ?? { label: c, cls: "text-muted-foreground" }
}

function FileGroup({
  label,
  files,
  onSelect,
}: {
  label: string
  files: GitFile[]
  onSelect: (f: GitFile) => void
  selected: string | null
}) {
  return (
    <div>
      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label} · {files.length}
      </div>
      {files.map((f) => {
        const meta = statusChar(f)
        const name = f.path.split("/").pop()
        const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""
        return (
          <button
            key={f.path}
            onClick={() => onSelect(f)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/60"
          >
            <FileDiff className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{name}</span>
            {dir && <span className="truncate text-[11px] text-muted-foreground/70">{dir}</span>}
            <span className={cn("ml-auto shrink-0 font-mono text-xs font-semibold", meta.cls)}>{meta.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function GitDiffBody({ diff }: { diff: GitDiff }) {
  if (diff.binary) {
    return <Empty icon={<FileDiff className="size-6" />} text="Binary file — no diff to show." />
  }
  if (!diff.diff.trim()) {
    return <Empty icon={<FileDiff className="size-6" />} text="No changes." />
  }
  return (
    <div className="flex-1 overflow-auto scrollbar-thin p-3">
      <DiffView diff={diff.diff} />
    </div>
  )
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
      {icon}
      <p className="text-sm text-balance">{text}</p>
    </div>
  )
}
