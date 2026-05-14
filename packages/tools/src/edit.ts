import { z } from "zod"
import type { Tool, ToolContext } from "@omni/core"
import { resolveUnderCwd } from "./util/path.ts"
import { summarizeChange } from "./util/diff.ts"

const EditArgs = z.object({
  path: z.string().min(1).describe("Path to edit, absolute or relative to cwd."),
  old_string: z
    .string()
    .min(1)
    .describe(
      "Exact substring to find. Whitespace is significant. Must be unique unless replace_all is true.",
    ),
  new_string: z.string().describe("Replacement string. May be empty to delete the match."),
  replace_all: z
    .boolean()
    .optional()
    .describe("Replace every occurrence rather than requiring uniqueness. Default false."),
})

export interface EditResult {
  readonly path: string
  readonly replacements: number
  readonly bytesBefore: number
  readonly bytesAfter: number
  readonly diff: string
}

const MAX_FILE_BYTES = 5_000_000

/**
 * Diff-based file edit via exact find/replace.
 *
 * Designed for small models: no need to manage diff line counts or fence
 * fidelity — emit the exact old text and the exact new text. The tool
 * rejects when `old_string` isn't found OR isn't unique (unless `replace_all`).
 * On failure, the error message shows what would have been found to help
 * the model self-correct.
 */
export const edit: Tool<z.infer<typeof EditArgs>, EditResult> = {
  name: "edit",
  description:
    "Edit a text file by replacing an exact substring. The old_string must match exactly (whitespace-significant) and be unique unless replace_all is true. Returns a short diff.",
  permission: "ask",
  schema: EditArgs,
  async execute(args, ctx: ToolContext): Promise<EditResult> {
    const p = resolveUnderCwd(args.path, ctx.cwd)
    const file = Bun.file(p)
    if (!(await file.exists())) throw new Error(`file not found: ${p}`)
    if (file.size > MAX_FILE_BYTES) {
      throw new Error(`file too large to edit safely: ${file.size} bytes (max ${MAX_FILE_BYTES})`)
    }
    const before = await file.text()

    const occurrences = countOccurrences(before, args.old_string)
    if (occurrences === 0) {
      throw new Error(
        `old_string not found in ${args.path}. Read the file first and copy the exact substring including whitespace.`,
      )
    }
    if (occurrences > 1 && !args.replace_all) {
      throw new Error(
        `old_string occurs ${occurrences} times in ${args.path}. Either make it unique (add more surrounding context) or pass replace_all: true.`,
      )
    }

    const after = args.replace_all
      ? before.replaceAll(args.old_string, args.new_string)
      : before.replace(args.old_string, args.new_string)

    await Bun.write(p, after)

    return {
      path: p,
      replacements: occurrences,
      bytesBefore: before.length,
      bytesAfter: after.length,
      diff: summarizeChange(before, after, 2),
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
