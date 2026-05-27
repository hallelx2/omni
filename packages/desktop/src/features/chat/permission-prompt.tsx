import { ShieldQuestion, Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useApp } from "@/store/app"
import type { PendingPermission } from "@/store/app"

const NO_PENDING: PendingPermission[] = []

export function PermissionPrompts({ sessionId }: { sessionId: string }) {
  const pending = useApp((s) => s.pending[sessionId]) ?? NO_PENDING
  const respond = useApp((s) => s.respondPermission)
  if (pending.length === 0) return null

  return (
    <div className="mx-auto w-full max-w-3xl px-5">
      <div className="flex flex-col gap-2">
        {pending.map((p) => (
          <PromptCard key={p.requestId} p={p} onDecide={(d) => respond(sessionId, p.requestId, d)} />
        ))}
      </div>
    </div>
  )
}

function PromptCard({ p, onDecide }: { p: PendingPermission; onDecide: (d: "allow" | "deny") => void }) {
  const args = typeof p.call.args === "object" ? p.call.args : { value: p.call.args }
  const summary =
    p.call.name === "bash"
      ? String((args as Record<string, unknown>).command ?? "")
      : JSON.stringify(args)

  return (
    <div className="attention reveal rounded-xl border border-warning/30 bg-[color-mix(in_oklch,var(--warning)_8%,var(--card))] p-3 shadow-soft">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-warning/15 text-warning">
          <ShieldQuestion className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            Allow <span className="font-mono text-warning">{p.call.name}</span>?
          </p>
          <pre className="mt-1.5 max-h-28 overflow-auto rounded-md border border-border bg-background/60 p-2 font-mono text-[11.5px] leading-relaxed scrollbar-thin">
            {summary}
          </pre>
        </div>
      </div>
      <div className="mt-2.5 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => onDecide("deny")}>
          <X className="size-3.5" /> Deny
        </Button>
        <Button size="sm" onClick={() => onDecide("allow")}>
          <Check className="size-3.5" /> Allow
        </Button>
      </div>
    </div>
  )
}
