import { useMemo } from "react"
import { cn } from "@/lib/utils"

interface Row {
  kind: "add" | "del" | "ctx" | "hunk" | "meta"
  old?: number
  new?: number
  text: string
}

function parseDiff(diff: string): Row[] {
  const rows: Row[] = []
  let oldN = 0
  let newN = 0
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
      if (m) {
        oldN = Number(m[1])
        newN = Number(m[2])
      }
      rows.push({ kind: "hunk", text: raw })
      continue
    }
    if (
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ") ||
      raw.startsWith("new file") ||
      raw.startsWith("deleted file") ||
      raw.startsWith("similarity ") ||
      raw.startsWith("rename ")
    ) {
      rows.push({ kind: "meta", text: raw })
      continue
    }
    if (raw.startsWith("+")) {
      rows.push({ kind: "add", new: newN++, text: raw.slice(1) })
    } else if (raw.startsWith("-")) {
      rows.push({ kind: "del", old: oldN++, text: raw.slice(1) })
    } else {
      rows.push({ kind: "ctx", old: oldN++, new: newN++, text: raw.startsWith(" ") ? raw.slice(1) : raw })
    }
  }
  // drop a trailing empty row
  if (rows.length && rows[rows.length - 1]!.text === "" && rows[rows.length - 1]!.kind === "ctx") rows.pop()
  return rows
}

export function DiffView({ diff, className }: { diff: string; className?: string }) {
  const rows = useMemo(() => parseDiff(diff), [diff])
  let adds = 0
  let dels = 0
  for (const r of rows) {
    if (r.kind === "add") adds++
    else if (r.kind === "del") dels++
  }

  return (
    <div className={cn("overflow-hidden rounded-md border border-border bg-card/50", className)}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="font-mono text-success">+{adds}</span>
        <span className="font-mono text-destructive">-{dels}</span>
        <span className="ml-auto">unified diff</span>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full border-collapse font-mono text-[12px] leading-[1.6]">
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className={cn(
                  r.kind === "add" && "bg-[var(--diff-add-bg)]",
                  r.kind === "del" && "bg-[var(--diff-del-bg)]",
                  r.kind === "hunk" && "bg-primary/5 select-none",
                )}
              >
                <td className="w-10 select-none border-r border-border/60 px-2 text-right align-top text-muted-foreground/50 tabular-nums">
                  {r.old ?? ""}
                </td>
                <td className="w-10 select-none border-r border-border/60 px-2 text-right align-top text-muted-foreground/50 tabular-nums">
                  {r.new ?? ""}
                </td>
                <td
                  className={cn(
                    "w-4 select-none px-1 text-center align-top",
                    r.kind === "add" && "text-[var(--diff-add-fg)]",
                    r.kind === "del" && "text-[var(--diff-del-fg)]",
                  )}
                >
                  {r.kind === "add" ? "+" : r.kind === "del" ? "-" : ""}
                </td>
                <td
                  className={cn(
                    "whitespace-pre px-2 align-top",
                    r.kind === "add" && "text-[var(--diff-add-fg)]",
                    r.kind === "del" && "text-[var(--diff-del-fg)]",
                    r.kind === "hunk" && "text-[var(--diff-hunk)]",
                    r.kind === "meta" && "text-muted-foreground/70",
                  )}
                >
                  {r.text || " "}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
