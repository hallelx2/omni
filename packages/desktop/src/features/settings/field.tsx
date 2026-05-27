import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title?: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("space-y-4", className)}>
      {(title || description) && (
        <div className="space-y-0.5">
          {title && <h3 className="text-sm font-semibold">{title}</h3>}
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      )}
      <div className="space-y-4">{children}</div>
    </section>
  )
}

/** Stacked: label above control, optional hint below. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Inline: label + description on the left, control on the right. */
export function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 rounded-lg border border-border bg-card/40 px-3.5 py-3">
      <div className="min-w-0 space-y-0.5">
        <Label className="block">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
