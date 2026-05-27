import { Fragment, useRef, useState } from "react"
import {
  ArrowUp,
  Square,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Hammer,
  Eye,
  Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"
import type { OmniConfig, ProviderInfo } from "@/lib/protocol"

export function Composer({ running }: { running: boolean }) {
  const [text, setText] = useState("")
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  const sendInput = useApp((s) => s.sendInput)
  const abort = useApp((s) => s.abort)
  const activeSessionId = useApp((s) => s.activeSessionId)
  const activeProjectId = useApp((s) => s.activeProjectId)
  const projects = useApp((s) => s.projects)
  const project = projects.find((p) => p.id === activeProjectId)
  const setProjectModel = useApp((s) => s.setProjectModel)
  const providers = useApp((s) => s.providers)
  const config = useApp((s) => s.config)
  const saveConfig = useApp((s) => s.saveConfig)

  const mode: "plan" | "build" = (config.modes?.default ?? "build") as "plan" | "build"

  function grow() {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 220) + "px"
  }

  function submit() {
    const value = text.trim()
    if (!value || running) return
    sendInput(value)
    setText("")
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = "auto"
    })
  }

  return (
    <div className="mx-auto w-full max-w-[46rem] px-6 pb-5 pt-2">
      <div
        className={cn(
          "rounded-xl border bg-card transition-all duration-[var(--duration-base)] ease-out",
          focused ? "border-foreground/30 shadow-[var(--glow)]" : "border-border-strong",
        )}
      >
        <div className="flex items-start gap-2 px-3 pt-2.5">
          <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground/60" />
          <textarea
            ref={ref}
            value={text}
            rows={1}
            placeholder="Ask anything…"
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              setText(e.target.value)
              grow()
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            className="max-h-[220px] min-h-6 flex-1 resize-none bg-transparent py-0.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground scrollbar-thin"
          />
        </div>

        <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5 pt-1">
          <div className="flex min-w-0 items-center gap-0.5">
            <ModeChip
              mode={mode}
              onChange={(m) =>
                void saveConfig(
                  { ...config, modes: { ...config.modes, default: m } } as OmniConfig,
                  { silent: true },
                )
              }
            />
            <ModelChip
              value={project?.modelRef}
              config={config}
              providers={providers}
              disabled={!project}
              onChange={(ref) => project && setProjectModel(project.id, ref)}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1 text-[10.5px] text-muted-foreground/60 sm:flex">
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9.5px]">⏎</kbd>
              send
            </span>
            {running ? (
              <Button
                size="icon-sm"
                variant="secondary"
                onClick={() => activeSessionId && abort(activeSessionId)}
                className="rounded-lg"
                title="Stop"
              >
                <Square className="size-3 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon-sm"
                onClick={submit}
                disabled={!text.trim()}
                className="rounded-lg [&_svg]:transition-transform [&_svg]:duration-[var(--duration-fast)] [&_svg]:ease-out hover:[&_svg]:-translate-y-px"
                title="Send (Enter)"
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const chipCls =
  "tactile inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"

function ModeChip({
  mode,
  onChange,
}: {
  mode: "plan" | "build"
  onChange: (m: "plan" | "build") => void
}) {
  const Icon = mode === "plan" ? Eye : Hammer
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={chipCls}>
          <Icon className="size-3" />
          <span className="capitalize">{mode}</span>
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <ModeOption current={mode} value="build" onChange={onChange} icon={Hammer} label="Build" hint="Full tools — agent can edit, run shells" />
        <ModeOption current={mode} value="plan" onChange={onChange} icon={Eye} label="Plan" hint="Read-only — planner-driven analysis" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ModeOption({
  current,
  value,
  onChange,
  icon: Icon,
  label,
  hint,
}: {
  current: "plan" | "build"
  value: "plan" | "build"
  onChange: (v: "plan" | "build") => void
  icon: typeof Hammer
  label: string
  hint: string
}) {
  return (
    <DropdownMenuItem onClick={() => onChange(value)} className="items-start py-2">
      <Icon className="mt-0.5 size-3.5" />
      <div className="flex min-w-0 flex-col">
        <span className="text-[12px] font-medium">{label}</span>
        <span className="text-[10.5px] text-muted-foreground">{hint}</span>
      </div>
      {current === value && <Check className="ml-auto mt-0.5 size-3.5" />}
    </DropdownMenuItem>
  )
}

function resolveModelLabel(value: string | undefined, config: OmniConfig): string {
  const ref = value ?? (config.adapter && config.model ? `${config.adapter}:${config.model}` : config.adapter)
  if (!ref) return "mock"
  const parts = ref.split(":")
  return parts.length > 1 ? parts.slice(1).join(":") : ref
}

function ModelChip({
  value,
  config,
  providers,
  disabled,
  onChange,
}: {
  value: string | undefined
  config: OmniConfig
  providers: ProviderInfo[]
  disabled?: boolean
  onChange: (v: string | undefined) => void
}) {
  const label = resolveModelLabel(value, config)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={chipCls} disabled={disabled}>
          <Sparkles className="size-3" />
          <span className="max-w-40 truncate font-mono">{label}</span>
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="max-h-80 w-64 overflow-y-auto scrollbar-thin">
        <DropdownMenuItem onClick={() => onChange(undefined)}>
          <span className="text-[12px]">Default (from settings)</span>
          {!value && <Check className="ml-auto size-3.5" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {providers.map((p) => (
          <Fragment key={p.id}>
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>{p.label}</span>
              {p.needsKey && !p.hasKey && <span className="text-[10px] text-warning">no key</span>}
            </DropdownMenuLabel>
            {p.models.map((m) => {
              const ref = `${p.id}:${m}`
              return (
                <DropdownMenuItem key={ref} onClick={() => onChange(ref)}>
                  <span className="font-mono text-[12px]">{m}</span>
                  {value === ref && <Check className="ml-auto size-3.5" />}
                </DropdownMenuItem>
              )
            })}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
