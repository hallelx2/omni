import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"

const DEFAULT_VALUE = "__default__"

export function ModelPicker({
  value,
  onChange,
  size = "sm",
  className,
  allowDefault = true,
}: {
  value: string | undefined
  onChange: (ref: string | undefined) => void
  size?: "sm" | "default"
  className?: string
  allowDefault?: boolean
}) {
  const providers = useApp((s) => s.providers)

  return (
    <Select
      value={value ?? DEFAULT_VALUE}
      onValueChange={(v) => onChange(v === DEFAULT_VALUE ? undefined : v)}
    >
      <SelectTrigger size={size} className={cn("gap-1.5", className)}>
        <SelectValue placeholder="Select model" />
      </SelectTrigger>
      <SelectContent>
        {allowDefault && (
          <>
            <SelectItem value={DEFAULT_VALUE}>Default (from settings)</SelectItem>
            <SelectSeparator />
          </>
        )}
        {providers.map((p) => (
          <SelectGroup key={p.id}>
            <SelectLabel className="flex items-center justify-between">
              <span>{p.label}</span>
              {p.needsKey && !p.hasKey && <span className="text-[10px] text-warning">no key</span>}
            </SelectLabel>
            {p.models.map((m) => (
              <SelectItem key={`${p.id}:${m}`} value={`${p.id}:${m}`}>
                {m}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
