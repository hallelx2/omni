import { resolve, relative, isAbsolute, sep } from "node:path"

/**
 * Resolve `input` against `cwd`. Returns the absolute path.
 *
 * If `cwd` is provided, paths that would escape it (via `..` segments or
 * absolute paths pointing outside) cause an error. Pass `{ allowEscape: true }`
 * to disable that check (e.g. read-only tools where the engine's permission
 * gate is the real boundary).
 */
export function resolveUnderCwd(
  input: string,
  cwd: string,
  opts: { readonly allowEscape?: boolean } = {},
): string {
  if (!input) throw new Error("path is empty")
  const abs = isAbsolute(input) ? resolve(input) : resolve(cwd, input)

  if (!opts.allowEscape) {
    const rel = relative(resolve(cwd), abs)
    if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
      throw new Error(`path escapes working directory: ${input}`)
    }
  }
  return abs
}
