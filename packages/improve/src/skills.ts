import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, delimiter } from "node:path"
import { userSkillsDir, workspacePaths } from "@omni/core"

/**
 * A skill is a reusable agent specialization: a system prompt + an optional
 * tool subset + optional permission overrides + activation triggers.
 *
 * Stored as `SKILL.md` under a per-skill directory:
 *
 * ```
 * ~/.omni/skills/
 *   test-author/
 *     SKILL.md
 *   pr-reviewer/
 *     SKILL.md
 * ```
 *
 * Frontmatter shape (parsed by the user-commands frontmatter parser):
 *
 * ```yaml
 * ---
 * name: test-author
 * description: Write tests for TypeScript files using bun:test
 * triggers:
 *   - "write tests for"
 *   - "test the"
 *   - "/test"
 * tools_only:
 *   - read_file
 *   - write_file
 *   - edit
 *   - bash
 * permission_overrides:
 *   bash:
 *     allow:
 *       - "^bun test"
 * ---
 * Body becomes the skill's system prompt.
 * ```
 */
export interface Skill {
  readonly name: string
  readonly description: string
  readonly triggers: readonly string[]
  readonly systemPrompt: string
  readonly toolsOnly?: readonly string[]
  readonly permissionOverrides?: Readonly<
    Record<string, { readonly allow?: readonly string[]; readonly deny?: readonly string[] }>
  >
  readonly source: "user" | "workspace"
  readonly path: string
}

// Re-using the existing frontmatter parser keeps the format consistent
// between slash commands and skills. Imported lazily to avoid a hard dep.
type FrontmatterFn = (raw: string) => { frontmatter: Record<string, unknown>; body: string }

let _parseFrontmatter: FrontmatterFn | null = null

/** Inject the frontmatter parser. Called by the CLI on startup; tests can pass their own. */
export function setFrontmatterParser(fn: FrontmatterFn): void {
  _parseFrontmatter = fn
}

function parse(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!_parseFrontmatter) {
    // Built-in fallback: detect `---\n...\n---\n` and return raw frontmatter as
    // an empty object. Skills can still load (body works) but typed fields lost.
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
    return match
      ? { frontmatter: {}, body: match[2] ?? "" }
      : { frontmatter: {}, body: raw }
  }
  return _parseFrontmatter(raw)
}

function loadFromDir(dir: string, source: "user" | "workspace"): Skill[] {
  if (!existsSync(dir)) return []
  const out: Skill[] = []
  for (const entry of readdirSync(dir)) {
    const skillPath = join(dir, entry, "SKILL.md")
    if (!existsSync(skillPath)) continue
    const stat = statSync(join(dir, entry))
    if (!stat.isDirectory()) continue
    try {
      const raw = readFileSync(skillPath, "utf8")
      const { frontmatter, body } = parse(raw)
      const name = (frontmatter.name as string) ?? entry
      out.push({
        name,
        description: (frontmatter.description as string) ?? "",
        triggers: Array.isArray(frontmatter.triggers)
          ? (frontmatter.triggers as string[])
          : [],
        systemPrompt: body.trim(),
        toolsOnly: Array.isArray(frontmatter.tools_only)
          ? (frontmatter.tools_only as string[])
          : undefined,
        permissionOverrides: isPlainObject(frontmatter.permission_overrides)
          ? (frontmatter.permission_overrides as Skill["permissionOverrides"])
          : undefined,
        source,
        path: skillPath,
      })
    } catch {
      // skip malformed skill
    }
  }
  return out
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/**
 * The directories scanned for skills, lowest-precedence first. Later roots
 * override earlier ones on a name collision (so the user's `~/.omni/skills`
 * and the workspace win over installed `~/.claude/skills`).
 *
 *   1. `~/.claude/skills`            — skills installed for Claude Code (read-only consumers)
 *   2. `$OMNI_SKILL_ROOTS` entries   — extra roots, OS-path-delimited
 *   3. `~/.omni/skills`              — the user's authored skills
 *   4. `<workspace>/.omni/skills`    — per-project skills
 */
export function skillSearchRoots(cwd?: string): Array<{ dir: string; source: "user" | "workspace" }> {
  const roots: Array<{ dir: string; source: "user" | "workspace" }> = []
  // Installed Claude-Code skills. Overridable via OMNI_CLAUDE_SKILLS_DIR; set it
  // to "" to disable (used by tests for hermeticity, since the default reads the
  // real home dir which OMNI_HOME does not redirect).
  const claude = process.env.OMNI_CLAUDE_SKILLS_DIR ?? join(homedir(), ".claude", "skills")
  if (claude && existsSync(claude)) roots.push({ dir: claude, source: "user" })
  for (const r of process.env.OMNI_SKILL_ROOTS?.split(delimiter) ?? []) {
    if (r && existsSync(r)) roots.push({ dir: r, source: "user" })
  }
  roots.push({ dir: userSkillsDir(), source: "user" })
  const ws = workspacePaths(cwd)
  if (ws) roots.push({ dir: ws.skills, source: "workspace" })
  return roots
}

/**
 * Load all skills from every search root. Later roots override earlier ones on
 * a name collision (workspace + `~/.omni/skills` win over installed skills).
 * Returns a Map keyed by skill name.
 */
export function loadSkills(cwd?: string): Map<string, Skill> {
  const map = new Map<string, Skill>()
  for (const { dir, source } of skillSearchRoots(cwd)) {
    for (const s of loadFromDir(dir, source)) map.set(s.name, s)
  }
  return map
}

/**
 * Keyword-based router: find a skill whose triggers match the input.
 * Triggers compare case-insensitively as substrings. The first skill that
 * matches wins (workspace skills are inserted last so they're checked last
 * iff iteration is in insertion order — but here we want workspace to win
 * when both match, so we iterate workspace-first).
 *
 * Returns null when no skill matches.
 */
export function findMatchingSkill(
  input: string,
  skills: Iterable<Skill>,
): Skill | null {
  const lower = input.toLowerCase()
  // Workspace first
  const arr = [...skills]
  arr.sort((a, b) => (a.source === b.source ? 0 : a.source === "workspace" ? -1 : 1))
  for (const skill of arr) {
    for (const trigger of skill.triggers) {
      if (lower.includes(trigger.toLowerCase())) return skill
    }
  }
  return null
}

/**
 * Apply a skill's tool filter to a tool list: returns only the tools whose
 * name appears in `skill.toolsOnly`. If `toolsOnly` is absent, returns all.
 */
export function filterToolsBySkill<T extends { name: string }>(
  tools: readonly T[],
  skill: Skill,
): readonly T[] {
  if (!skill.toolsOnly) return tools
  const allow = new Set(skill.toolsOnly)
  return tools.filter((t) => allow.has(t.name))
}
