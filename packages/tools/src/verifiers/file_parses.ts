import { resolve, extname } from "node:path"
import type { Verifier, VerifyContext, VerifierResult } from "@omni/core"
import type { ApplyPatchResult } from "../apply_patch.ts"

/**
 * Cheap syntactic guard: after a file change, attempt to parse the file.
 * Catches malformed JSON, syntactically broken TS/JS — the kind of error
 * a weak model produces by mistyping a brace or comma. Fast (one parse
 * per touched file) and zero config.
 *
 * Behaviour:
 *   - .json → JSON.parse
 *   - .ts/.tsx/.js/.jsx/.mjs/.cjs → Bun.Transpiler#scan, which raises on
 *     syntax errors but not type errors (those belong to TypecheckVerifier)
 *   - anything else → skip
 *
 * Tools whose result identifies the changed paths:
 *   - apply_patch → result.applied[*].path + result.failed[*].path
 *   - edit / write / multi_edit → these expect the engine to pass the
 *     target path in the call args (we read from args.path)
 */
export class FileParsesVerifier implements Verifier {
  readonly name = "file-parses"
  readonly appliesTo = ["edit", "write", "multi_edit", "apply_patch"] as const
  readonly cost = "cheap" as const

  async verify(ctx: VerifyContext): Promise<VerifierResult> {
    const paths = collectTouchedPaths(ctx)
    if (paths.length === 0) {
      return {
        verifier: this.name,
        status: "skip",
        reason: "could not infer touched paths from tool args/result",
      }
    }

    const failures: { path: string; reason: string }[] = []
    let parsed = 0
    let skipped = 0
    for (const rel of paths) {
      const ext = extname(rel).toLowerCase()
      if (!PARSEABLE.has(ext)) {
        skipped++
        continue
      }
      const abs = resolve(ctx.cwd, rel)
      try {
        const content = await Bun.file(abs).text()
        if (ext === ".json") {
          JSON.parse(content)
        } else {
          // Bun's transpiler scans for syntax; throws on parse error but
          // ignores type errors (which is what we want — that's typecheck's job).
          const t = new Bun.Transpiler({ loader: ext === ".tsx" || ext === ".jsx" ? "tsx" : ext === ".ts" ? "ts" : "js" })
          t.scan(content)
        }
        parsed++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        failures.push({ path: rel, reason: msg.slice(0, 400) })
      }
    }

    if (failures.length > 0) {
      const lines = failures.map((f) => `  - ${f.path}: ${f.reason}`).join("\n")
      return {
        verifier: this.name,
        status: "fail",
        reason: `${failures.length} file(s) did not parse`,
        feedback: `These files now contain a syntax error:\n${lines}\n\nRe-open each file, locate the syntax error, and fix it. Do NOT just retry the same edit.`,
        details: { failures, parsed, skipped },
      }
    }
    if (parsed === 0) {
      return {
        verifier: this.name,
        status: "skip",
        reason: `no parseable files touched (${skipped} unsupported extensions)`,
      }
    }
    return { verifier: this.name, status: "pass", details: { parsed, skipped } }
  }
}

const PARSEABLE = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"])

function collectTouchedPaths(ctx: VerifyContext): string[] {
  // apply_patch: read paths from result.applied[].path and result.failed[].path
  if (ctx.call.name === "apply_patch") {
    const r = ctx.result as ApplyPatchResult | undefined
    if (r && typeof r === "object") {
      const out: string[] = []
      if (Array.isArray(r.applied)) {
        for (const a of r.applied) if (a.action !== "deleted") out.push(a.path)
      }
      // Don't check failed paths — they weren't written, so a parse failure
      // would be unrelated to this tool call.
      return out
    }
    return []
  }
  // edit / write / multi_edit: read path from the call args
  const args = ctx.call.args as { path?: unknown; file_path?: unknown } | null
  if (args && typeof args === "object") {
    const p = (args.path ?? args.file_path) as unknown
    if (typeof p === "string") return [p]
  }
  return []
}
