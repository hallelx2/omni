import { useEffect, useRef } from "react"
import { TimelineItemView } from "./timeline-item"
import type { TimelineItem, Phase } from "@/store/timeline"

export function MessageList({
  items,
  running,
  phase,
  iteration,
}: {
  items: TimelineItem[]
  running: boolean
  phase: Phase
  iteration: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (stick.current) el.scrollTop = el.scrollHeight
  })

  function onScroll() {
    const el = ref.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    stick.current = distance < 80
  }

  // Show the live "thinking" row only in the gaps — when the agent is working
  // but not actively streaming text (caret shows that) or running a tool
  // (the tool block's spinner shows that).
  const showWorking = running && phase === "thinking"

  return (
    <div ref={ref} onScroll={onScroll} className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="mx-auto flex max-w-[46rem] flex-col gap-5 px-6 py-7">
        {items.map((item) => (
          <TimelineItemView key={item.id} item={item} />
        ))}
        {showWorking && <WorkingRow iteration={iteration} />}
      </div>
    </div>
  )
}

function WorkingRow({ iteration }: { iteration: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
        <span className="relative inline-flex size-2 rounded-full bg-primary" />
      </span>
      <span className="shimmer text-[13px] font-medium">Thinking…</span>
      {iteration > 1 && (
        <span className="font-mono text-[11px] text-muted-foreground/50">step {iteration}</span>
      )}
    </div>
  )
}
