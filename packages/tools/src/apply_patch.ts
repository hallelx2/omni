import { z } from "zod"
import type { Tool, ToolContext } from "@omni/core"
import { resolveUnderCwd } from "./util/path.ts"
import { summarizeChange } from "./util/diff.ts"

/**
 * Apply a unified-diff patch to one or more files.
 *
 * Why a separate tool from `edit`: `edit`'s exact find/replace breaks on
 * any whitespace drift. Models on real codebases produce diffs (that's
 * what diff exists for); `apply_patch` accepts them directly with
 * fuzziness on context-line whitespace.
 *
 * Format: standard unified diff. Multi-file patches are supported via
 * `diff --git` / `--- ` / `+++ ` headers. New files use `/dev/null` as
 * the source. File deletions use `/dev/null` as the target.
 *
 *   --- a/src/auth.ts
 *   +++ b/src/auth.ts
 *   @@ -10,4 +10,5 @@
 *    function login(user, pass) {
 *   -  return basicAuth(user, pass)
 *   +  // Migrated to JWT
 *   +  return jwtAuth(user, pass)
 *    }
 */
const ApplyPatchArgs = z.object({
  patch: z
    .string()
    .min(1)
    .describe("Unified diff. Multi-file patches OK. Use /dev/null for adds/deletes."),
  dry_run: z
    .boolean()
    .optional()
    .describe("If true, parse + validate but do not write. Useful for previewing."),
})

export interface ApplyPatchHunkResult {
  readonly path: string
  readonly hunks: number
  readonly added: number
  readonly removed: number
  readonly action: "modified" | "created" | "deleted"
  readonly diff: string
}

export interface ApplyPatchResult {
  readonly applied: readonly ApplyPatchHunkResult[]
  readonly failed: ReadonlyArray<{ path: string; reason: string }>
}

/** A single hunk parsed from a unified diff. */
interface Hunk {
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly lines: readonly string[]
}

/** A file-level change with its hunks. */
interface FilePatch {
  readonly oldPath: string
  readonly newPath: string
  readonly hunks: readonly Hunk[]
}

const MAX_FILE_BYTES = 5_000_000

export const applyPatch: Tool<z.infer<typeof ApplyPatchArgs>, ApplyPatchResult> = {
  name: "apply_patch",
  description:
    "Apply a unified-diff patch to one or more files. Tolerates whitespace drift on context lines. Use /dev/null for new files or deletions. Supports `dry_run` for previewing.",
  permission: "ask",
  schema: ApplyPatchArgs,
  async execute(args, ctx: ToolContext): Promise<ApplyPatchResult> {
    const patches = parseUnifiedDiff(args.patch)
    if (patches.length === 0) {
      throw new Error("no file patches parsed from input (is the diff well-formed?)")
    }

    const applied: ApplyPatchHunkResult[] = []
    const failed: { path: string; reason: string }[] = []

    for (const p of patches) {
      const target = p.newPath === "/dev/null" ? p.oldPath : p.newPath
      const isDelete = p.newPath === "/dev/null"
      const isCreate = p.oldPath === "/dev/null"

      try {
        const abs = resolveUnderCwd(target, ctx.cwd)
        const file = Bun.file(abs)
        const exists = await file.exists()

        if (isCreate) {
          if (exists) {
            failed.push({ path: target, reason: "create patch targets existing file" })
            continue
          }
          const content = hunksToCreatedFile(p.hunks)
          if (!args.dry_run) await Bun.write(abs, content)
          const added = content.split("\n").length
          applied.push({
            path: target,
            hunks: p.hunks.length,
            added,
            removed: 0,
            action: "created",
            diff: `+ created (${added} lines)`,
          })
          continue
        }

        if (!exists) {
          failed.push({ path: target, reason: "file not found" })
          continue
        }
        if (file.size > MAX_FILE_BYTES) {
          failed.push({ path: target, reason: `file too large (${file.size} bytes)` })
          continue
        }

        if (isDelete) {
          if (!args.dry_run) await Bun.file(abs).delete()
          applied.push({
            path: target,
            hunks: p.hunks.length,
            added: 0,
            removed: 1,
            action: "deleted",
            diff: "- deleted",
          })
          continue
        }

        const beforeRaw = await file.text()
        // Detect line ending in the source so the rewrite preserves it.
        // Windows files commonly use CRLF; diff context lines never include
        // \r, so we normalise to LF for matching and re-encode on write.
        const eol = detectEol(beforeRaw)
        const before = eol === "\r\n" ? beforeRaw.replace(/\r\n/g, "\n") : beforeRaw
        const { after: afterLf, added, removed } = applyHunks(before, p.hunks)
        const after = eol === "\r\n" ? afterLf.replace(/\n/g, "\r\n") : afterLf
        if (!args.dry_run) await Bun.write(abs, after)
        applied.push({
          path: target,
          hunks: p.hunks.length,
          added,
          removed,
          action: "modified",
          diff: summarizeChange(before, afterLf, 2),
        })
      } catch (e) {
        failed.push({ path: target, reason: (e as Error).message })
      }
    }

    if (applied.length === 0 && failed.length > 0) {
      // Surface aggregate failure to the model so it can correct
      throw new Error(
        `all ${failed.length} file patch(es) failed: ` +
          failed.map((f) => `${f.path}: ${f.reason}`).join("; "),
      )
    }

    return { applied, failed }
  },
}

// ─── parser ────────────────────────────────────────────────────────────────

/**
 * Parse a unified diff into per-file FilePatch entries. Tolerates:
 *   - `diff --git ...` header lines (ignored)
 *   - missing newline-at-end-of-file markers (ignored)
 *   - "no newline at end of file" remarks
 *   - fenced markdown around the diff (```diff ... ```)
 */
export function parseUnifiedDiff(input: string): readonly FilePatch[] {
  // Strip surrounding markdown fence if present
  const fenced = /^```(?:diff|patch)?\r?\n([\s\S]*?)\r?\n```\s*$/.exec(input.trim())
  const text = fenced ? fenced[1]! : input

  const lines = text.split(/\r?\n/)
  const patches: FilePatch[] = []
  let i = 0
  while (i < lines.length) {
    // Find a file header
    while (i < lines.length && !lines[i]!.startsWith("--- ")) i++
    if (i >= lines.length) break
    const oldHeader = lines[i]!
    const newHeader = lines[i + 1] ?? ""
    if (!newHeader.startsWith("+++ ")) {
      i++
      continue
    }
    const oldPath = stripHeaderPath(oldHeader.slice(4).trim())
    const newPath = stripHeaderPath(newHeader.slice(4).trim())
    i += 2

    const hunks: Hunk[] = []
    while (i < lines.length && lines[i]!.startsWith("@@")) {
      const header = lines[i]!
      const m = /^@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/.exec(header)
      if (!m) {
        i++
        continue
      }
      const oldStart = parseInt(m[1]!, 10)
      const oldLines = m[2] ? parseInt(m[2], 10) : 1
      const newStart = parseInt(m[3]!, 10)
      const newLines = m[4] ? parseInt(m[4], 10) : 1
      i++
      const hunkLines: string[] = []
      while (
        i < lines.length &&
        !lines[i]!.startsWith("@@") &&
        !lines[i]!.startsWith("--- ") &&
        !lines[i]!.startsWith("diff ")
      ) {
        if (lines[i] === "\\ No newline at end of file") {
          i++
          continue
        }
        hunkLines.push(lines[i]!)
        i++
      }
      hunks.push({ oldStart, oldLines, newStart, newLines, lines: hunkLines })
    }
    patches.push({ oldPath, newPath, hunks })
  }
  return patches
}

function stripHeaderPath(p: string): string {
  // Strip leading "a/" or "b/" prefixes added by git
  if (p === "/dev/null") return p
  return p.replace(/^[ab]\//, "")
}

// ─── applier ───────────────────────────────────────────────────────────────

interface ApplyOutcome {
  readonly after: string
  readonly added: number
  readonly removed: number
}

/**
 * Apply hunks to source text. Strategy: locate each hunk by matching its
 * context lines starting at `oldStart`. If exact match fails, fall back to a
 * fuzzy search (whitespace-collapsed) up to ±20 lines around the expected
 * position. If a hunk can't be located, throw with a precise reason.
 */
function applyHunks(source: string, hunks: readonly Hunk[]): ApplyOutcome {
  let lines = source.split("\n")
  let added = 0
  let removed = 0

  for (const h of hunks) {
    const oldChunk: string[] = []
    const newChunk: string[] = []
    for (const l of h.lines) {
      if (l.startsWith("-")) oldChunk.push(l.slice(1))
      else if (l.startsWith("+")) newChunk.push(l.slice(1))
      else if (l.startsWith(" ")) {
        oldChunk.push(l.slice(1))
        newChunk.push(l.slice(1))
      } else {
        // Header noise or empty — skip
      }
    }
    const pos = findHunkPosition(lines, oldChunk, h.oldStart - 1)
    if (pos < 0) {
      throw new Error(
        `hunk @@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@ could not be located`,
      )
    }
    lines = [...lines.slice(0, pos), ...newChunk, ...lines.slice(pos + oldChunk.length)]
    added += newChunk.filter((_l, idx) => oldChunk[idx] !== newChunk[idx]).length
    removed += oldChunk.filter((_l, idx) => oldChunk[idx] !== newChunk[idx]).length
  }

  return { after: lines.join("\n"), added, removed }
}

function findHunkPosition(
  lines: readonly string[],
  hunkOldChunk: readonly string[],
  expectedStart: number,
): number {
  if (hunkOldChunk.length === 0) return expectedStart
  // Try exact match at expected position first.
  if (matches(lines, hunkOldChunk, expectedStart)) return expectedStart
  // Then a tight window around the expected position.
  for (let offset = 1; offset <= 20; offset++) {
    if (matches(lines, hunkOldChunk, expectedStart + offset)) return expectedStart + offset
    if (matches(lines, hunkOldChunk, expectedStart - offset)) return expectedStart - offset
  }
  // Then a fuzzy whitespace-collapsed pass across the file.
  const normChunk = hunkOldChunk.map(normalize)
  for (let i = 0; i <= lines.length - hunkOldChunk.length; i++) {
    let ok = true
    for (let j = 0; j < hunkOldChunk.length; j++) {
      if (normalize(lines[i + j]!) !== normChunk[j]) {
        ok = false
        break
      }
    }
    if (ok) return i
  }
  return -1
}

function matches(lines: readonly string[], chunk: readonly string[], start: number): boolean {
  if (start < 0 || start + chunk.length > lines.length) return false
  for (let i = 0; i < chunk.length; i++) {
    if (lines[start + i] !== chunk[i]) return false
  }
  return true
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

function hunksToCreatedFile(hunks: readonly Hunk[]): string {
  // For new files, the diff has one hunk whose `+` lines are the entire
  // content. Strip the `+` prefix.
  const out: string[] = []
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.startsWith("+")) out.push(l.slice(1))
    }
  }
  return out.join("\n")
}

/**
 * Detect whether a source string uses CRLF or LF. Defaults to LF when no
 * line endings are present (a single-line file or empty content).
 */
function detectEol(src: string): "\n" | "\r\n" {
  const firstNl = src.indexOf("\n")
  if (firstNl <= 0) return "\n"
  return src[firstNl - 1] === "\r" ? "\r\n" : "\n"
}
