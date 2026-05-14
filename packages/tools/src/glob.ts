import { z } from "zod"
import { resolve } from "node:path"
import { stat } from "node:fs/promises"
import type { Tool, ToolContext } from "@omni/core"

const GlobArgs = z.object({
  pattern: z
    .string()
    .min(1)
    .describe(
      "Glob pattern (e.g. '**/*.ts', 'src/**/*.test.{ts,js}'). Matched against paths relative to cwd.",
    ),
  cwd: z
    .string()
    .optional()
    .describe("Override the search root (relative to the tool's cwd). Default: tool cwd."),
  limit: z
    .number()
    .int()
    .positive()
    .max(2_000)
    .optional()
    .describe("Max paths to return. Default 200."),
})

export interface GlobResult {
  readonly pattern: string
  readonly root: string
  readonly count: number
  readonly truncated: boolean
  /** Paths relative to `root`, most recently modified first. */
  readonly paths: readonly string[]
}

const DEFAULT_LIMIT = 200

/**
 * Glob-match files under `cwd`. Returns paths sorted by modification time
 * (most recent first) — small models usually care about recently-edited files.
 * Skips `node_modules`, `.git`, `dist`, `.turbo` by default.
 */
export const glob: Tool<z.infer<typeof GlobArgs>, GlobResult> = {
  name: "glob",
  description:
    "Find files matching a glob pattern (e.g. '**/*.ts'). Returns paths relative to the search root, sorted by modification time. Skips node_modules/.git/dist by default.",
  permission: "auto",
  schema: GlobArgs,
  async execute(args, ctx: ToolContext): Promise<GlobResult> {
    const root = resolve(ctx.cwd, args.cwd ?? ".")
    const limit = args.limit ?? DEFAULT_LIMIT
    const glob = new Bun.Glob(args.pattern)

    const matches: Array<{ path: string; mtime: number }> = []
    let scanned = 0
    for await (const rel of glob.scan({
      cwd: root,
      onlyFiles: true,
      followSymlinks: false,
    })) {
      if (isIgnored(rel)) continue
      scanned++
      if (matches.length >= limit + 1) {
        // collect one more to know we truncated, but stop fetching mtimes
        matches.push({ path: rel, mtime: 0 })
        if (matches.length >= limit + 50) break
        continue
      }
      try {
        const s = await stat(resolve(root, rel))
        matches.push({ path: rel, mtime: s.mtimeMs })
      } catch {
        matches.push({ path: rel, mtime: 0 })
      }
    }

    matches.sort((a, b) => b.mtime - a.mtime)
    const truncated = matches.length > limit
    const kept = truncated ? matches.slice(0, limit) : matches

    return {
      pattern: args.pattern,
      root,
      count: kept.length,
      truncated,
      paths: kept.map((m) => m.path),
    }
  },
}

const IGNORED_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".turbo",
  ".next",
  "coverage",
  ".cache",
])

function isIgnored(path: string): boolean {
  for (const segment of path.split(/[\\/]/)) {
    if (IGNORED_SEGMENTS.has(segment)) return true
  }
  return false
}
