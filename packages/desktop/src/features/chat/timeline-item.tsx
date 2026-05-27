import { useState } from "react"
import {
  Terminal,
  FileText,
  FilePen,
  FolderSearch,
  Search,
  Globe,
  Wrench,
  ChevronRight,
  Check,
  X,
  Loader2,
  Info,
  TriangleAlert,
  CircleCheck,
  Brain,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { DiffView } from "@/components/diff-view"
import { cn } from "@/lib/utils"
import { Markdown } from "./markdown"
import type { TimelineItem as Item } from "@/store/timeline"

export function TimelineItemView({ item }: { item: Item }) {
  switch (item.kind) {
    case "user":
      return <UserItem text={item.text} />
    case "assistant":
      return <AssistantItem text={item.text} streaming={item.streaming} />
    case "thinking":
      return <ThinkingItem text={item.text} />
    case "tool":
      return <ToolItem item={item} />
    case "notice":
      return <NoticeItem level={item.level} text={item.text} />
  }
}

function UserItem({ text }: { text: string }) {
  return (
    <div className="reveal flex justify-end">
      <div className="max-w-[82%] whitespace-pre-wrap rounded-xl rounded-br-sm border border-border-strong bg-card px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-soft">
        {text}
      </div>
    </div>
  )
}

function AssistantItem({ text, streaming }: { text: string; streaming?: boolean }) {
  if (!text && !streaming) return null
  return (
    <div className="reveal min-w-0">
      {text ? (
        <div className="relative">
          <Markdown>{text}</Markdown>
          {streaming && (
            <span className="ml-0.5 inline-block h-[1.05em] w-[0.5em] translate-y-[0.18em] rounded-[1px] bg-primary caret-blink align-baseline" />
          )}
        </div>
      ) : streaming ? (
        <span className="inline-flex items-center gap-1 py-1.5">
          <Dot /> <Dot delay={160} /> <Dot delay={320} />
        </span>
      ) : null}
    </div>
  )
}

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <span
      className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60"
      style={{ animationDelay: `${delay}ms` }}
    />
  )
}

function ThinkingItem({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="reveal">
      <button
        onClick={() => setOpen((o) => !o)}
        className="group flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Brain className="size-3.5" />
        <span className="italic">Thinking</span>
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="mt-1.5 whitespace-pre-wrap border-l-2 border-border pl-3 text-xs italic leading-relaxed text-muted-foreground">
          {text}
        </div>
      )}
    </div>
  )
}

const TOOL_ICONS: Record<string, typeof Wrench> = {
  bash: Terminal,
  read_file: FileText,
  write_file: FilePen,
  edit: FilePen,
  multi_edit: FilePen,
  apply_patch: FilePen,
  glob: FolderSearch,
  grep: Search,
  web_fetch: Globe,
}

function argSummary(name: string, args: unknown): string {
  if (!args || typeof args !== "object") return ""
  const a = args as Record<string, unknown>
  if (name === "bash") return String(a.command ?? "")
  if (typeof a.path === "string") return a.path
  if (typeof a.pattern === "string") return a.pattern
  if (typeof a.url === "string") return a.url
  const first = Object.values(a)[0]
  return typeof first === "string" ? first : ""
}

function getDiff(result: unknown): string | null {
  if (result && typeof result === "object") {
    const d = (result as { diff?: unknown }).diff
    if (typeof d === "string" && d.trim()) return d
  }
  return null
}

function ToolItem({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false)
  const Icon = TOOL_ICONS[item.name] ?? Wrench
  const summary = argSummary(item.name, item.args)
  const diff = getDiff(item.result)
  const running = item.status === "running"
  const errored = item.status === "error"

  return (
    <div className="reveal">
      <div
        className={cn(
          "overflow-hidden rounded-lg border bg-card/50 transition-colors",
          running ? "border-primary/35" : errored ? "border-destructive/30" : "border-border",
        )}
      >
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-accent/40"
        >
          <ChevronRight
            className={cn("size-3.5 shrink-0 text-muted-foreground/70 transition-transform", open && "rotate-90")}
          />
          <Icon className={cn("size-3.5 shrink-0", running ? "text-primary" : errored ? "text-destructive" : "text-muted-foreground")} />
          <span className="shrink-0 font-mono text-[12.5px] font-medium tracking-tight">{item.name}</span>
          {summary && (
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground">{summary}</span>
          )}
          <ToolStatus item={item} />
        </button>

        {open && (
          <div className="reveal space-y-2.5 border-t border-border bg-background/50 p-2.5">
            {!diff && (
              <Section label="arguments">
                <CodeBlock>{JSON.stringify(item.args, null, 2)}</CodeBlock>
              </Section>
            )}
            {errored && item.error && (
              <div className="rounded-md border border-destructive/25 bg-destructive/8 p-2.5 font-mono text-[12px] text-destructive">
                {item.error}
              </div>
            )}
            {diff ? (
              <DiffView diff={diff} />
            ) : item.result !== undefined && !errored ? (
              <Section label="result">
                <ToolResult name={item.name} result={item.result} args={item.args} />
              </Section>
            ) : null}
          </div>
        )}
      </div>

      {item.verifiers && item.verifiers.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {item.verifiers.map((v, i) => (
            <Badge key={i} variant={v.status === "pass" ? "success" : v.status === "fail" ? "destructive" : "muted"}>
              {v.status === "pass" ? <Check /> : v.status === "fail" ? <X /> : null}
              {v.name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

function ToolStatus({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  if (item.status === "running") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin text-primary" />
        {item.progress && <span className="max-w-32 truncate">{item.progress}</span>}
      </span>
    )
  }
  const ms = item.durationMs
  const time = ms != null ? (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`) : null
  if (item.status === "error") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[11px]">
        <X className="size-3.5 text-destructive" />
        {time && <span className="text-muted-foreground tabular-nums">{time}</span>}
      </span>
    )
  }
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11px]">
      <Check className="size-3.5 text-success" />
      {time && <span className="text-muted-foreground tabular-nums">{time}</span>}
    </span>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</div>
      {children}
    </div>
  )
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-md border border-border bg-card/60 p-2.5 font-mono text-[11.5px] leading-relaxed scrollbar-thin">
      {children}
    </pre>
  )
}

function ToolResult({ name, result, args }: { name: string; result: unknown; args: unknown }) {
  if (name === "bash" && result && typeof result === "object") {
    const r = result as { stdout?: string; stderr?: string; exitCode?: number }
    const cmd = (args as { command?: string } | null)?.command
    return (
      <div className="overflow-hidden rounded-md border border-white/10 bg-[oklch(0.12_0_0)] text-[11.5px] leading-relaxed text-[oklch(0.82_0_0)]">
        {cmd && (
          <div className="flex items-center gap-2 border-b border-white/8 px-2.5 py-1.5 font-mono">
            <span className="text-[oklch(0.78_0.14_152)]">$</span>
            <span className="truncate text-[oklch(0.93_0_0)]">{cmd}</span>
          </div>
        )}
        <div className="max-h-72 overflow-auto p-2.5 font-mono scrollbar-thin">
          {r.stdout ? <pre className="whitespace-pre-wrap">{truncate(r.stdout, 6000)}</pre> : null}
          {r.stderr ? (
            <pre className="mt-1 whitespace-pre-wrap text-[oklch(0.75_0.16_25)]">{truncate(r.stderr, 3000)}</pre>
          ) : null}
          {!r.stdout && !r.stderr && <span className="text-[oklch(0.55_0_0)]">(no output)</span>}
        </div>
        {typeof r.exitCode === "number" && (
          <div className="border-t border-white/8 px-2.5 py-1 font-mono text-[10.5px]">
            <span className={r.exitCode === 0 ? "text-[oklch(0.78_0.14_152)]" : "text-[oklch(0.75_0.16_25)]"}>
              exit {r.exitCode}
            </span>
          </div>
        )}
      </div>
    )
  }
  if (typeof result === "string") return <CodeBlock>{truncate(result, 6000)}</CodeBlock>
  return <CodeBlock>{truncate(JSON.stringify(result, null, 2), 6000)}</CodeBlock>
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `\n… (${s.length - n} more chars)` : s
}

const NOTICE_STYLES = {
  info: { icon: Info, cls: "text-muted-foreground" },
  warn: { icon: TriangleAlert, cls: "text-warning" },
  error: { icon: X, cls: "text-destructive" },
  success: { icon: CircleCheck, cls: "text-success" },
} as const

function NoticeItem({ level, text }: { level: "info" | "warn" | "error" | "success"; text: string }) {
  const { icon: Icon, cls } = NOTICE_STYLES[level]
  return (
    <div className="reveal flex items-center gap-2">
      <Icon className={cn("size-3.5 shrink-0", cls)} />
      <span className={cn("text-xs", cls)}>{text}</span>
    </div>
  )
}
