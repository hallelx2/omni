import { z } from "zod"
import { resolve } from "node:path"
import type { Tool, ToolContext } from "@omni/core"

// Detect ripgrep once at module load. When present, we shell out to it for
// large codebases; otherwise we fall back to the pure-JS implementation below.
const RG_PATH: string | null = Bun.which("rg")

const GrepArgs = z.object({
  pattern: z.string().min(1).describe("Regular expression pattern (JS flavor)."),
  path: z
    .string()
    .optional()
    .describe("File or directory to search (relative to cwd). Default: cwd."),
  glob: z
    .string()
    .optional()
    .describe("Restrict search to files matching this glob (e.g. '**/*.ts')."),
  case_insensitive: z.boolean().optional().describe("Case-insensitive match. Default false."),
  limit: z
    .number()
    .int()
    .positive()
    .max(2_000)
    .optional()
    .describe("Max matching lines to return. Default 200."),
})

export interface GrepMatch {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly text: string
}

export interface GrepResult {
  readonly pattern: string
  readonly root: string
  readonly filesSearched: number
  readonly count: number
  readonly truncated: boolean
  readonly matches: readonly GrepMatch[]
}

const DEFAULT_LIMIT = 200
const MAX_FILE_BYTES = 5_000_000

/**
 * Recursive content search. Prefers `rg` (ripgrep) when available for speed;
 * falls back to a pure-JS implementation otherwise. Skips binary files and
 * the usual ignore paths.
 */
export const grep: Tool<z.infer<typeof GrepArgs>, GrepResult> = {
  name: "grep",
  description:
    "Search file contents using a regex. Recursive under the given path (default cwd). Supports glob filter and case_insensitive. Returns matching lines with file:line:column.",
  permission: "auto",
  schema: GrepArgs,
  async execute(args, ctx: ToolContext): Promise<GrepResult> {
    if (RG_PATH) {
      try {
        return await grepWithRipgrep(args, ctx, RG_PATH)
      } catch {
        // fall through to JS implementation
      }
    }
    const root = resolve(ctx.cwd, args.path ?? ".")
    const limit = args.limit ?? DEFAULT_LIMIT
    const flags = args.case_insensitive ? "gi" : "g"
    let re: RegExp
    try {
      re = new RegExp(args.pattern, flags)
    } catch (e) {
      throw new Error(`invalid regex: ${(e as Error).message}`)
    }

    const fileFilter = args.glob ? new Bun.Glob(args.glob) : null
    const matches: GrepMatch[] = []
    let filesSearched = 0
    let truncated = false

    for await (const rel of new Bun.Glob("**/*").scan({
      cwd: root,
      onlyFiles: true,
      followSymlinks: false,
    })) {
      if (isIgnored(rel)) continue
      if (fileFilter && !fileFilter.match(rel)) continue
      if (ctx.signal.aborted) break
      if (matches.length >= limit) {
        truncated = true
        break
      }

      const absolute = resolve(root, rel)
      const file = Bun.file(absolute)
      if (file.size === 0 || file.size > MAX_FILE_BYTES) continue
      const headBuf = new Uint8Array(await file.slice(0, 8_192).arrayBuffer())
      if (isBinary(headBuf)) continue

      let text: string
      try {
        text = await file.text()
      } catch {
        continue
      }
      filesSearched++

      const lines = text.split("\n")
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        re.lastIndex = 0
        const m = re.exec(line)
        if (m) {
          matches.push({
            file: rel,
            line: i + 1,
            column: (m.index ?? 0) + 1,
            text: clipLine(line, 240),
          })
          if (matches.length >= limit) {
            truncated = true
            break
          }
        }
      }
    }

    return {
      pattern: args.pattern,
      root,
      filesSearched,
      count: matches.length,
      truncated,
      matches,
    }
  },
}

function isBinary(buf: Uint8Array): boolean {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

function clipLine(line: string, max: number): string {
  return line.length > max ? `${line.slice(0, max)}…` : line
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

async function grepWithRipgrep(
  args: z.infer<typeof GrepArgs>,
  ctx: ToolContext,
  rg: string,
): Promise<GrepResult> {
  const root = resolve(ctx.cwd, args.path ?? ".")
  const limit = args.limit ?? DEFAULT_LIMIT
  const argv: string[] = [
    rg,
    "--json",
    "--max-count",
    String(limit),
    "--no-config",
    ...(args.case_insensitive ? ["--ignore-case"] : []),
    ...(args.glob ? ["--glob", args.glob] : []),
    "--regexp",
    args.pattern,
  ]
  const proc = Bun.spawn([...argv, root], {
    stdout: "pipe",
    stderr: "pipe",
    signal: ctx.signal,
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0 && exitCode !== 1) {
    // 1 = no matches; anything else is a real error
    throw new Error(`rg exited ${exitCode}: ${stderr}`)
  }

  const matches: GrepMatch[] = []
  let filesSearched = 0
  let truncated = false
  for (const line of stdout.split("\n")) {
    if (!line) continue
    try {
      const ev = JSON.parse(line) as { type: string; data: Record<string, unknown> }
      if (ev.type === "match" && matches.length < limit) {
        const d = ev.data as {
          path: { text: string }
          line_number: number
          submatches: Array<{ start: number; match: { text: string } }>
          lines: { text: string }
        }
        for (const sm of d.submatches) {
          if (matches.length >= limit) {
            truncated = true
            break
          }
          matches.push({
            file: d.path.text.replace(root, "").replace(/^[\\/]/, ""),
            line: d.line_number,
            column: sm.start + 1,
            text: clipLine(d.lines.text.trimEnd(), 240),
          })
        }
      } else if (ev.type === "begin") {
        filesSearched++
      }
    } catch {
      // skip malformed JSON
    }
  }

  return {
    pattern: args.pattern,
    root,
    filesSearched,
    count: matches.length,
    truncated,
    matches,
  }
}
