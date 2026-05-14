import { z } from "zod"
import type { Tool, ToolContext } from "@omni/core"
import { resolveUnderCwd } from "./util/path.ts"
import { summarizeChange } from "./util/diff.ts"

const Replacement = z.object({
  old_string: z.string().min(1),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
})

const MultiEditArgs = z.object({
  path: z.string().min(1),
  edits: z.array(Replacement).min(1).describe("Edits applied in order; later edits see earlier results."),
})

export interface MultiEditResult {
  readonly path: string
  readonly editCount: number
  readonly replacements: number
  readonly bytesBefore: number
  readonly bytesAfter: number
  readonly diff: string
}

const MAX_FILE_BYTES = 5_000_000

/**
 * Apply multiple find/replace edits to a single file in a single call.
 * Edits are applied in sequence: later edits operate on the result of
 * earlier ones. If any edit fails (string not found, ambiguous match),
 * the whole operation is rolled back (file is not modified).
 */
export const multiEdit: Tool<z.infer<typeof MultiEditArgs>, MultiEditResult> = {
  name: "multi_edit",
  description:
    "Apply multiple find/replace edits to a single file atomically. Edits run in order; failure of any edit reverts the entire operation.",
  permission: "ask",
  schema: MultiEditArgs,
  async execute(args, ctx: ToolContext): Promise<MultiEditResult> {
    const p = resolveUnderCwd(args.path, ctx.cwd)
    const file = Bun.file(p)
    if (!(await file.exists())) throw new Error(`file not found: ${p}`)
    if (file.size > MAX_FILE_BYTES) {
      throw new Error(`file too large: ${file.size} bytes`)
    }
    const before = await file.text()

    let current = before
    let totalReplacements = 0
    for (let i = 0; i < args.edits.length; i++) {
      const e = args.edits[i]!
      const occurrences = countOccurrences(current, e.old_string)
      if (occurrences === 0) {
        throw new Error(
          `edit ${i + 1}/${args.edits.length}: old_string not found. (No changes were saved.)`,
        )
      }
      if (occurrences > 1 && !e.replace_all) {
        throw new Error(
          `edit ${i + 1}/${args.edits.length}: old_string occurs ${occurrences} times — either disambiguate or set replace_all. (No changes were saved.)`,
        )
      }
      current = e.replace_all
        ? current.replaceAll(e.old_string, e.new_string)
        : current.replace(e.old_string, e.new_string)
      totalReplacements += occurrences
    }

    await Bun.write(p, current)
    return {
      path: p,
      editCount: args.edits.length,
      replacements: totalReplacements,
      bytesBefore: before.length,
      bytesAfter: current.length,
      diff: summarizeChange(before, current, 2),
    }
  },
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let n = 0
  let idx = 0
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    n++
    idx += needle.length
  }
  return n
}
