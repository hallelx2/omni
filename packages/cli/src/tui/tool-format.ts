/**
 * Per-tool presentation — opencode's idiom: every tool renders as an icon
 * plus a human-readable label built from its *specific* arguments
 * (command, path, pattern, url …), never a raw JSON blob. A handful of
 * tools (bash) also surface a body of output; the rest stay one-liners.
 *
 * Shared by the message log (MessageList) and the permission prompt so
 * both speak the same language and neither shows JSON.
 */

type Args = Record<string, unknown>

const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
const arg = (args: Args | undefined, ...keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = asString(args?.[k])
    if (v) return v
  }
  return undefined
}

/** Tail-truncate a path (keep the filename + nearest parents), forward slashes. */
export function shortPath(p: string, max = 48): string {
  const norm = p.replace(/\\/g, "/")
  if (norm.length <= max) return norm
  return `…${norm.slice(-(max - 1))}`
}

function quote(s: string | undefined): string {
  return s ? `"${s}"` : ""
}

/** A glyph per tool, opencode-style. */
export function toolIcon(name: string): string {
  switch (name) {
    case "bash":              return "$"
    case "read_file":         return "→"
    case "write_file":        return "←"
    case "edit":
    case "multi_edit":
    case "apply_patch":       return "±"
    case "glob":              return "✱"
    case "grep":              return "✱"
    case "web_fetch":         return "%"
    default:                  return "⚙"
  }
}

/** Count items in a result for the "(N matches)" suffix — no JSON. */
function resultCount(result: unknown): number | undefined {
  if (Array.isArray(result)) return result.length
  if (typeof result === "string") {
    const t = result.trim()
    if (!t) return 0
    return t.split("\n").filter(Boolean).length
  }
  if (result && typeof result === "object") {
    const o = result as Record<string, unknown>
    for (const k of ["count", "matches", "total"]) if (typeof o[k] === "number") return o[k] as number
    for (const k of ["files", "results", "matches"]) if (Array.isArray(o[k])) return (o[k] as unknown[]).length
  }
  return undefined
}

/**
 * The inline label for a tool — what shows on the one-line tool row and in
 * the permission prompt. Pure prose, no JSON. `result` is optional and only
 * used to append match counts once a tool has completed.
 */
export function toolLabel(name: string, args: Args | undefined, result?: unknown): string {
  switch (name) {
    case "bash":
      return arg(args, "command") ?? "command"
    case "read_file":
      return `Read ${shortPath(arg(args, "path", "filePath") ?? "")}`
    case "write_file":
      return `Write ${shortPath(arg(args, "path", "filePath") ?? "")}`
    case "edit":
    case "multi_edit":
    case "apply_patch":
      return `Edit ${shortPath(arg(args, "path", "filePath") ?? "")}`
    case "glob": {
      const n = resultCount(result)
      return `Glob ${quote(arg(args, "pattern"))}${countSuffix(n)}`
    }
    case "grep": {
      const n = resultCount(result)
      const where = arg(args, "path") ? ` in ${shortPath(arg(args, "path")!)}` : ""
      return `Grep ${quote(arg(args, "pattern"))}${where}${countSuffix(n)}`
    }
    case "web_fetch":
      return `Fetch ${arg(args, "url") ?? ""}`
    default:
      return `${name}${argSummary(args)}`
  }
}

function countSuffix(n: number | undefined): string {
  if (n === undefined) return ""
  return ` (${n} ${n === 1 ? "match" : "matches"})`
}

/** Fallback for MCP / unknown tools: `key=value` pairs, primitives only, no JSON. */
function argSummary(args: Args | undefined): string {
  const entries = Object.entries(args ?? {})
  if (entries.length === 0) return ""
  const parts = entries.slice(0, 4).map(([k, v]) => {
    if (typeof v === "string") return `${k}=${v.length > 24 ? v.slice(0, 24) + "…" : v}`
    if (typeof v === "number" || typeof v === "boolean") return `${k}=${v}`
    if (Array.isArray(v)) return `${k}=[${v.length}]`
    return `${k}=…`
  })
  return ` ${parts.join(" ")}`
}

/**
 * The optional output body for a tool — only tools whose output is worth
 * showing inline return text here (bash). Everything else returns null so
 * the row stays a one-liner. Never JSON: object results are reduced to
 * their human-meaningful text fields.
 */
export function toolBlock(name: string, result: unknown): string | null {
  if (result === null || result === undefined) return null
  if (name === "bash") {
    const o = (typeof result === "object" ? result : {}) as Record<string, unknown>
    const stdout = asString(o.stdout) ?? (typeof result === "string" ? result : "")
    const stderr = asString(o.stderr) ?? ""
    const exit = typeof o.exitCode === "number" ? o.exitCode : undefined
    const lines: string[] = []
    if (stdout.trim()) lines.push(stdout.trimEnd())
    if (stderr.trim()) lines.push(stderr.trimEnd())
    if (exit !== undefined && exit !== 0) lines.push(`exit ${exit}`)
    const out = lines.join("\n")
    return out.trim() ? out : null
  }
  return null
}
