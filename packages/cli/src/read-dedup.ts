import { resolve } from "node:path"
import { statSync } from "node:fs"
import type { Tool, ToolContext } from "@omni/core"

/**
 * Wrap `read_file` so a repeat read of the SAME range of an UNCHANGED file
 * (same mtime) returns a short stub instead of re-sending the bytes — the
 * content is already in the conversation, and re-sending it just inflates the
 * context (and the bill) on every later turn. After an edit the file's mtime
 * changes, so a re-read still returns fresh content.
 *
 * State is per instance, so create one per engine/session (the main engine
 * gets the wrapped tool; subagents keep the raw one — their contexts differ).
 */
export function makeDedupReadFile(base: Tool): Tool {
  const sent = new Map<string, number>() // key → mtimeMs at last full send
  return {
    ...base,
    async execute(args: unknown, ctx: ToolContext) {
      const a = (args ?? {}) as { path?: string; start_line?: number; end_line?: number }
      let key: string | null = null
      let mtime = 0
      try {
        const p = resolve(ctx.cwd, a.path ?? "")
        mtime = statSync(p).mtimeMs
        key = `${p}|${a.start_line ?? ""}|${a.end_line ?? ""}`
        if (sent.get(key) === mtime) {
          return (
            `[read_file: "${a.path}" is unchanged since you read it earlier this session — ` +
            `reuse that earlier output instead of re-reading. Edit the file first if you need a fresh view.]`
          )
        }
      } catch {
        // stat failed (missing file / unusual path) → delegate; base reports the real error.
      }
      const result = await base.execute(args, ctx)
      if (key !== null) sent.set(key, mtime)
      return result
    },
  }
}
