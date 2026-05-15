import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, basename, extname } from "node:path"
import { userCommandsDir, workspacePaths } from "@omni/core"

/**
 * A user-defined slash command loaded from a `commands/<name>.md` file under
 * either `~/.omni/` or the workspace `.omni/`. Each command has YAML-ish
 * frontmatter for metadata and a markdown body that becomes a prompt
 * template, with `{{name}}` substitutions for arguments.
 *
 * Example file: `~/.omni/commands/commit.md`
 * ```markdown
 * ---
 * name: commit
 * description: Stage and commit modified files with a generated message
 * args:
 *   - name: scope
 *     optional: true
 * ---
 * Look at the staged + unstaged diff. Write a short commit message that
 * captures what changed and why.{{#scope}} Scope it as `feat({{scope}})`.{{/scope}}
 * Run `git commit -m "<message>"`.
 * ```
 *
 * Invocation: `/commit auth` → body rendered with `{{scope}}` = "auth",
 * `{{$ARGS}}` = "auth", `{{1}}` = "auth", sent to engine.run().
 */
export interface UserCommand {
  readonly name: string
  readonly description: string
  readonly args: ReadonlyArray<{ name: string; optional?: boolean; description?: string }>
  readonly template: string
  readonly source: "workspace" | "user"
  readonly path: string
}

/**
 * Tokenize an argument string that may contain quoted segments:
 *   `auth "fix bug"` → ["auth", "fix bug"]
 *   `'a b' c`        → ["a b", "c"]
 *
 * Honors both single and double quotes; allows escaping the quote char
 * with `\` inside its own kind.
 */
export function parseArgs(input: string): string[] {
  const out: string[] = []
  let cur = ""
  let quote: '"' | "'" | null = null
  let escape = false
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!
    if (escape) {
      cur += c
      escape = false
      continue
    }
    if (c === "\\") {
      escape = true
      continue
    }
    if (quote) {
      if (c === quote) {
        quote = null
      } else {
        cur += c
      }
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    if (/\s/.test(c)) {
      if (cur.length > 0) {
        out.push(cur)
        cur = ""
      }
      continue
    }
    cur += c
  }
  if (cur.length > 0) out.push(cur)
  return out
}

/**
 * Render a command's template by substituting:
 *   - `{{$ARGS}}`      → entire arg string
 *   - `{{1}}`, `{{2}}` → positional arg by 1-based index
 *   - `{{name}}`       → named arg by frontmatter declaration
 *   - `{{#name}}…{{/name}}` → conditional block, included only when `name` is set
 */
export function renderCommand(cmd: UserCommand, args: string[]): string {
  const named: Record<string, string> = {}
  for (let i = 0; i < cmd.args.length; i++) {
    const a = cmd.args[i]!
    if (args[i] !== undefined) named[a.name] = args[i]!
  }

  let out = cmd.template

  // Conditional blocks first so empty substitutions inside them don't leave gaps.
  out = out.replace(
    /\{\{#([a-zA-Z_][a-zA-Z0-9_]*)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, name: string, body: string) => (named[name] ? body : ""),
  )

  // Named substitutions
  out = out.replace(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_, name: string) => named[name] ?? "")

  // Positional substitutions
  out = out.replace(/\{\{(\d+)\}\}/g, (_, n: string) => args[parseInt(n, 10) - 1] ?? "")

  // $ARGS
  out = out.replace(/\{\{\$ARGS\}\}/g, args.join(" "))

  return out.trim()
}

interface Frontmatter {
  readonly name?: string
  readonly description?: string
  readonly args?: ReadonlyArray<{ name: string; optional?: boolean; description?: string }>
}

/**
 * Minimal YAML-ish frontmatter parser tuned for the command/skill file
 * format. Supports:
 *   key: value
 *   key:
 *     - item
 *     - { name: x, optional: true }
 *   key:
 *     subkey: value
 *
 * We deliberately avoid pulling in a full YAML parser — the format is
 * limited and stable. If users need something fancier they can ship JSON
 * in the same file (we detect leading `{` and JSON.parse).
 */
export function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!match) return { frontmatter: {}, body: raw }
  const fmRaw = match[1]!
  const body = match[2] ?? ""

  // JSON-mode escape hatch
  const trimmed = fmRaw.trim()
  if (trimmed.startsWith("{")) {
    try {
      return { frontmatter: JSON.parse(trimmed) as Frontmatter, body }
    } catch {
      return { frontmatter: {}, body }
    }
  }

  const fm: Record<string, unknown> = {}
  const lines = fmRaw.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/.exec(line)
    if (!m) {
      i++
      continue
    }
    const key = m[1]!
    const rawValue = m[2]!.trim()
    if (rawValue === "") {
      // Multi-line value: list or nested object
      const child: string[] = []
      i++
      while (i < lines.length && (lines[i]!.startsWith("  ") || lines[i]!.startsWith("\t") || lines[i] === "")) {
        if (lines[i] !== "") child.push(lines[i]!.replace(/^\s{2}|\t/, ""))
        i++
      }
      fm[key] = parseListOrObject(child)
    } else {
      fm[key] = parseScalar(rawValue)
      i++
    }
  }
  return { frontmatter: fm as Frontmatter, body }
}

function parseScalar(s: string): unknown {
  if (s === "true") return true
  if (s === "false") return false
  if (s === "null") return null
  const n = Number(s)
  if (!Number.isNaN(n) && s.match(/^-?\d+(\.\d+)?$/)) return n
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1)
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1)
  return s
}

function parseListOrObject(lines: string[]): unknown {
  if (lines.length === 0) return null
  // List if any non-empty line starts with `- `
  if (lines.some((l) => l.trim().startsWith("- "))) {
    return parseList(lines)
  }
  // Otherwise nested object
  const obj: Record<string, unknown> = {}
  for (const line of lines) {
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/.exec(line)
    if (m) obj[m[1]!] = parseScalar(m[2]!.trim())
  }
  return obj
}

function parseList(lines: string[]): unknown[] {
  const items: unknown[] = []
  let current: string[] = []
  for (const line of lines) {
    if (line.trim().startsWith("- ")) {
      if (current.length > 0) items.push(parseListItem(current))
      current = [line.trim().slice(2)]
    } else if (current.length > 0) {
      current.push(line.replace(/^\s{2}/, ""))
    }
  }
  if (current.length > 0) items.push(parseListItem(current))
  return items
}

function parseListItem(lines: string[]): unknown {
  const head = lines[0]!.trim()
  if (head.includes(":") && !head.startsWith("{")) {
    const obj: Record<string, unknown> = {}
    for (const line of lines) {
      const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/.exec(line.trim())
      if (m) obj[m[1]!] = parseScalar(m[2]!.trim())
    }
    return obj
  }
  return parseScalar(head)
}

/** Load all commands from a directory; returns empty array if dir missing. */
function loadFromDir(dir: string, source: "user" | "workspace"): UserCommand[] {
  if (!existsSync(dir)) return []
  const out: UserCommand[] = []
  for (const entry of readdirSync(dir)) {
    if (extname(entry) !== ".md") continue
    const path = join(dir, entry)
    try {
      const raw = readFileSync(path, "utf8")
      const { frontmatter, body } = parseFrontmatter(raw)
      const name = (frontmatter.name as string) ?? basename(entry, ".md")
      out.push({
        name,
        description: (frontmatter.description as string) ?? "",
        args: Array.isArray(frontmatter.args)
          ? (frontmatter.args as UserCommand["args"])
          : [],
        template: body.trim(),
        source,
        path,
      })
    } catch {
      // skip malformed file
    }
  }
  return out
}

/**
 * Load all user-defined commands, workspace first (which override user-level
 * commands with the same name), then user-level. Returns a Map keyed by
 * command name for O(1) lookup.
 */
export function loadUserCommands(cwd?: string): Map<string, UserCommand> {
  const map = new Map<string, UserCommand>()
  const userCmds = loadFromDir(userCommandsDir(), "user")
  for (const c of userCmds) map.set(c.name, c)

  const ws = workspacePaths(cwd)
  if (ws) {
    const wsCmds = loadFromDir(ws.commands, "workspace")
    for (const c of wsCmds) map.set(c.name, c) // workspace overrides user
  }
  return map
}
