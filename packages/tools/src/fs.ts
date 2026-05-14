import { z } from "zod"
import type { Tool, ToolContext } from "@omni/core"
import { resolveUnderCwd } from "./util/path.ts"

const MAX_READ_BYTES = 1_000_000

const ReadArgs = z.object({
  path: z.string().min(1).describe("Path to read, absolute or relative to cwd."),
  start_line: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("1-based start line. Default: 1."),
  end_line: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("1-based inclusive end line. Default: end of file."),
})

export interface ReadResult {
  readonly path: string
  readonly content: string
  readonly totalLines: number
  readonly startLine: number
  readonly endLine: number
  readonly truncated: boolean
}

export const readFile: Tool<z.infer<typeof ReadArgs>, ReadResult | string> = {
  name: "read_file",
  description:
    "Read a text file. Optionally pass start_line/end_line (1-based, inclusive) to read a slice. Up to ~1 MB.",
  permission: "auto",
  schema: ReadArgs,
  async execute(args, ctx: ToolContext) {
    const p = resolveUnderCwd(args.path, ctx.cwd, { allowEscape: true })
    const file = Bun.file(p)
    if (!(await file.exists())) throw new Error(`file not found: ${p}`)
    if (file.size > MAX_READ_BYTES) {
      throw new Error(
        `file too large: ${file.size} bytes (max ${MAX_READ_BYTES}). Use start_line/end_line or bash head/tail.`,
      )
    }
    const text = await file.text()

    // No slice requested → return raw string for back-compat.
    if (args.start_line === undefined && args.end_line === undefined) {
      return text
    }

    const lines = text.split("\n")
    const startLine = args.start_line ?? 1
    const endLine = Math.min(args.end_line ?? lines.length, lines.length)
    if (startLine > lines.length) {
      return {
        path: p,
        content: "",
        totalLines: lines.length,
        startLine,
        endLine: startLine - 1,
        truncated: false,
      }
    }
    const slice = lines.slice(startLine - 1, endLine).join("\n")
    return {
      path: p,
      content: slice,
      totalLines: lines.length,
      startLine,
      endLine,
      truncated: endLine < lines.length,
    }
  },
}

const WriteArgs = z.object({
  path: z.string().min(1),
  content: z.string(),
})

export const writeFile: Tool<z.infer<typeof WriteArgs>, { readonly bytes: number; readonly path: string }> = {
  name: "write_file",
  description: "Write text content to a file (creates or overwrites). Asks for permission first.",
  permission: "ask",
  schema: WriteArgs,
  async execute(args, ctx: ToolContext) {
    const p = resolveUnderCwd(args.path, ctx.cwd)
    const bytes = await Bun.write(p, args.content)
    return { bytes, path: p }
  },
}
