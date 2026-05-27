import { useCallback, useEffect, useRef, useState } from "react"
import hljs from "highlight.js"
import {
  Folder,
  FolderOpen,
  File,
  ChevronRight,
  RefreshCw,
  ArrowLeft,
  FileCode2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { useApp } from "@/store/app"
import { api } from "@/lib/api"
import { cn, formatBytes } from "@/lib/utils"
import type { FileEntry, FileContent } from "@/lib/protocol"

export function FilesPanel() {
  const projectId = useApp((s) => s.activeProjectId)
  const [root, setRoot] = useState<FileEntry[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({})
  const [viewing, setViewing] = useState<FileContent | null>(null)
  const [loading, setLoading] = useState(false)

  const loadRoot = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const tree = await api.fileTree(projectId, "")
      setRoot(tree.entries)
      setChildren({})
      setExpanded({})
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setViewing(null)
    void loadRoot()
  }, [loadRoot])

  async function toggleDir(path: string) {
    const isOpen = expanded[path]
    setExpanded((e) => ({ ...e, [path]: !isOpen }))
    if (!isOpen && !children[path] && projectId) {
      const tree = await api.fileTree(projectId, path)
      setChildren((c) => ({ ...c, [path]: tree.entries }))
    }
  }

  async function openFile(path: string) {
    if (!projectId) return
    const content = await api.readFile(projectId, path)
    setViewing(content)
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        {viewing ? (
          <>
            <Button variant="ghost" size="icon-sm" onClick={() => setViewing(null)}>
              <ArrowLeft className="size-4" />
            </Button>
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{viewing.path}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(viewing.bytes)}</span>
          </>
        ) : (
          <>
            <FileCode2 className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Explorer</span>
            <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={loadRoot} disabled={loading}>
              <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            </Button>
          </>
        )}
      </header>

      {viewing ? (
        <FileViewer content={viewing} />
      ) : (
        <div className="flex-1 overflow-auto scrollbar-thin py-1">
          {root.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              expanded={expanded}
              children={children}
              onToggle={toggleDir}
              onOpen={openFile}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TreeNode({
  entry,
  depth,
  expanded,
  children,
  onToggle,
  onOpen,
}: {
  entry: FileEntry
  depth: number
  expanded: Record<string, boolean>
  children: Record<string, FileEntry[]>
  onToggle: (path: string) => void
  onOpen: (path: string) => void
}) {
  const isOpen = expanded[entry.path]
  return (
    <div>
      <button
        onClick={() => (entry.type === "dir" ? onToggle(entry.path) : onOpen(entry.path))}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px] transition-colors hover:bg-accent/60"
        style={{ paddingLeft: depth * 12 + 8 }}
      >
        {entry.type === "dir" ? (
          <>
            <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
            {isOpen ? (
              <FolderOpen className="size-3.5 shrink-0 text-primary/80" />
            ) : (
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5 shrink-0" />
            <File className="size-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {entry.type === "dir" && isOpen && (
        <div>
          {(children[entry.path] ?? []).map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              expanded={expanded}
              children={children}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FileViewer({ content }: { content: FileContent }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || content.binary) return
    el.removeAttribute("data-highlighted")
    try {
      hljs.highlightElement(el)
    } catch {
      // ignore unknown languages
    }
  }, [content])

  if (content.binary) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <File className="size-6" />
        <p className="text-sm">Binary file ({formatBytes(content.bytes)})</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto scrollbar-thin">
      {content.tooLarge && (
        <div className="border-b border-border bg-warning/10 px-3 py-1.5 text-[11px] text-warning">
          Large file — showing the first {formatBytes(content.content.length)}.
        </div>
      )}
      <pre className="p-3 font-mono text-[12px] leading-relaxed">
        <code ref={ref} className={`language-${content.language}`}>
          {content.content}
        </code>
      </pre>
    </div>
  )
}
