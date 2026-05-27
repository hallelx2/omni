import { useRef, useState } from "react"
import { TerminalSquare, Plus, X, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTerminals } from "@/store/terminals"
import { useApp } from "@/store/app"
import { TerminalView } from "./terminal-view"

export function TerminalPanel() {
  const open = useTerminals((s) => s.open)
  const tabs = useTerminals((s) => s.tabs)
  const activeId = useTerminals((s) => s.activeId)
  const setActive = useTerminals((s) => s.setActive)
  const closeTab = useTerminals((s) => s.closeTab)
  const newTab = useTerminals((s) => s.newTab)
  const setOpen = useTerminals((s) => s.setOpen)

  const projects = useApp((s) => s.projects)
  const activeProjectId = useApp((s) => s.activeProjectId)
  const projectPath = projects.find((p) => p.id === activeProjectId)?.path

  const [height, setHeight] = useState(300)
  const drag = useRef<{ startY: number; startH: number } | null>(null)

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { startY: e.clientY, startH: height }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return
    const next = drag.current.startH + (drag.current.startY - e.clientY)
    setHeight(Math.min(700, Math.max(140, next)))
  }
  function onPointerUp(e: React.PointerEvent) {
    drag.current = null
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  }

  return (
    <div
      className={cn("flex shrink-0 flex-col border-t border-border bg-[#121212]", !open && "hidden")}
      style={{ height }}
    >
      {/* resize handle */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="h-1 w-full cursor-row-resize bg-transparent transition-colors hover:bg-foreground/20"
      />

      {/* tab bar */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-white/8 pl-2 pr-1.5">
        <TerminalSquare className="size-3.5 shrink-0 text-[#8a8a8a]" />
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-thin">
          {tabs.map((t, i) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={cn(
                "group flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
                t.id === activeId
                  ? "bg-white/10 text-[#e8e8e8]"
                  : "text-[#9a9a9a] hover:bg-white/5 hover:text-[#d0d0d0]",
              )}
            >
              <span className="font-mono">
                {i + 1}:{t.title}
              </span>
              <span
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(t.id)
                }}
                className="grid size-4 place-items-center rounded opacity-0 transition hover:bg-white/15 group-hover:opacity-100"
              >
                <X className="size-3" />
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={() => projectPath && newTab(projectPath)}
          disabled={!projectPath}
          title="New terminal"
          className="grid size-7 shrink-0 place-items-center rounded-md text-[#9a9a9a] transition hover:bg-white/8 hover:text-[#e0e0e0] disabled:opacity-40"
        >
          <Plus className="size-4" />
        </button>
        <button
          onClick={() => setOpen(false)}
          title="Hide terminal (Ctrl+`)"
          className="grid size-7 shrink-0 place-items-center rounded-md text-[#9a9a9a] transition hover:bg-white/8 hover:text-[#e0e0e0]"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>

      {/* terminal bodies — all kept mounted, visibility toggled */}
      <div className="relative min-h-0 flex-1">
        {tabs.length === 0 ? (
          <div className="grid h-full place-items-center text-xs text-[#7a7a7a]">
            No terminal — press + to open one.
          </div>
        ) : (
          tabs.map((t) => (
            <div
              key={t.id}
              className="absolute inset-0"
              style={{ display: t.id === activeId ? "block" : "none" }}
            >
              <TerminalView id={t.id} cwd={t.cwd} visible={open && t.id === activeId} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
