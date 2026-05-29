import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import {
  userAgentsDir,
  workspacePaths,
  RuleBasedPermissions,
  looksDestructive,
  type PermissionGate,
  type PermissionRule,
} from "@omni/core"
import { DEFAULT_AGENT_FILES } from "./default-agents.ts"

/**
 * Prebuilt subagents are reusable, sandboxed specializations the main agent
 * delegates to — each its own child engine with its own model, tool subset,
 * and *enforced* permission rules. They are spawned as tools (individually or
 * fanned out via `dispatch_agents`), distinct from skills, which only modify
 * the *main* engine's prompt + tool set for a turn.
 *
 * Stored as `AGENT.md` under a per-agent directory, mirroring skills:
 *
 * ```
 * ~/.omni/agents/explore/AGENT.md
 * .omni/agents/explore/AGENT.md   (workspace override)
 * ```
 *
 * Frontmatter may be YAML (simple fields) or JSON (recommended for the nested
 * permission map). The shipped defaults use JSON. Recognized fields:
 *
 * ```jsonc
 * {
 *   "name": "test",
 *   "description": "Writes and runs tests.",
 *   "model": "anthropic:claude-haiku-4-5",   // optional; defaults to main model
 *   "tools": ["read_file", "edit", "bash"],   // allowlist (alias: tools_only)
 *   "permissionDefault": "deny",              // gate default (alias: permission_default)
 *   "permissions": {                          // per-tool allow/deny regexes
 *     "bash": { "allow": ["^bun test\\b"] },
 *     "edit": { "allow": ["\\.test\\.[jt]sx?$"] }
 *   },
 *   "maxIterations": 20,                       // alias: max_iterations
 *   "history": "isolate"                       // "isolate" | "keep" | { "keepLast": N }
 * }
 * ```
 * The markdown body becomes the agent's system prompt.
 */
export interface AgentToolRules {
  /** Regex sources; a call is allowed if it matches any (allow-list semantics). */
  readonly allow?: readonly string[]
  /** Regex sources; a matching call is denied (evaluated before allows). */
  readonly deny?: readonly string[]
}

export interface Agent {
  readonly name: string
  readonly description: string
  /** "provider:model" or bare model name. Undefined → use the main model. */
  readonly model?: string
  /** Tool-name allowlist. Undefined → all tools the parent passes through. */
  readonly tools?: readonly string[]
  /** Per-tool allow/deny regex rules, keyed by tool name. */
  readonly permissions?: Readonly<Record<string, AgentToolRules>>
  /** Decision when no rule matches. Default "deny". */
  readonly permissionDefault?: "allow" | "deny"
  /** Opt out of the built-in destructive-bash deny. Default false. */
  readonly allowDestructive?: boolean
  readonly maxIterations?: number
  readonly history?: "isolate" | "keep" | { readonly keepLast: number }
  /** Skill names to load and inline into this agent's system prompt. */
  readonly skills?: readonly string[]
  /** Language hints used by the auto-router (e.g. ["typescript", "python"]). Lowercased. */
  readonly languages?: readonly string[]
  /** Domain hints used by the auto-router (e.g. ["frontend", "data"]). Lowercased. */
  readonly domains?: readonly string[]
  /** Additional .md files (relative to the agent dir) appended to the prompt. */
  readonly context?: readonly string[]
  /** How much skill body to inline. Default "summary". */
  readonly skillResources?: "summary" | "full" | "none"
  readonly systemPrompt: string
  readonly source: "default" | "user" | "workspace"
  readonly path: string
}

// ─── Frontmatter parsing (shared parser injected by the CLI; JSON fallback) ──

type FrontmatterFn = (raw: string) => { frontmatter: Record<string, unknown>; body: string }

let _parseFrontmatter: FrontmatterFn | null = null

/** Inject the frontmatter parser (the CLI passes the same one skills use). */
export function setAgentFrontmatterParser(fn: FrontmatterFn): void {
  _parseFrontmatter = fn
}

function parse(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  if (_parseFrontmatter) return _parseFrontmatter(raw)
  // Built-in fallback: split the fence and JSON.parse a `{...}` frontmatter so
  // the JSON-authored defaults load even before a parser is injected (tests).
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!match) return { frontmatter: {}, body: raw }
  const body = match[2] ?? ""
  const fmRaw = (match[1] ?? "").trim()
  if (fmRaw.startsWith("{")) {
    try {
      return { frontmatter: JSON.parse(fmRaw) as Record<string, unknown>, body }
    } catch {
      return { frontmatter: {}, body }
    }
  }
  return { frontmatter: {}, body }
}

// ─── Field coercion ─────────────────────────────────────────────────────────

function toStringArray(v: unknown): readonly string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.filter((x): x is string => typeof x === "string")
  return out.length > 0 ? out : undefined
}

function normalizePermissions(v: unknown): Record<string, AgentToolRules> | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined
  const out: Record<string, AgentToolRules> = {}
  for (const [tool, rule] of Object.entries(v as Record<string, unknown>)) {
    if (typeof rule !== "object" || rule === null) continue
    const r = rule as Record<string, unknown>
    const allow = toStringArray(r.allow)
    const deny = toStringArray(r.deny)
    if (allow || deny) out[tool] = { allow, deny }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parseHistory(v: unknown): Agent["history"] {
  if (v === "isolate" || v === "keep") return v
  if (typeof v === "object" && v !== null) {
    const n = (v as { keepLast?: unknown }).keepLast
    if (typeof n === "number" && n >= 0) return { keepLast: n }
  }
  return undefined
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

function buildAgent(
  fm: Record<string, unknown>,
  body: string,
  dirName: string,
  source: Agent["source"],
  path: string,
): Agent {
  const name = typeof fm.name === "string" && fm.name.length > 0 ? fm.name : dirName
  const permDefault = fm.permissionDefault ?? fm.permission_default
  return {
    name,
    description: typeof fm.description === "string" ? fm.description : "",
    model: typeof fm.model === "string" && fm.model.length > 0 ? fm.model : undefined,
    tools: toStringArray(fm.tools) ?? toStringArray(fm.tools_only) ?? toStringArray(fm.toolsOnly),
    permissions: normalizePermissions(fm.permissions ?? fm.permission_overrides),
    permissionDefault: permDefault === "allow" ? "allow" : "deny",
    allowDestructive: fm.allowDestructive === true || fm.allow_destructive === true,
    maxIterations: num(fm.maxIterations) ?? num(fm.max_iterations),
    history: parseHistory(fm.history),
    skills: toStringArray(fm.skills),
    languages: lowerArray(toStringArray(fm.languages)),
    domains: lowerArray(toStringArray(fm.domains)),
    context: toStringArray(fm.context),
    skillResources:
      fm.skillResources === "full" || fm.skillResources === "none"
        ? fm.skillResources
        : fm.skillResources === "summary"
          ? "summary"
          : undefined,
    systemPrompt: body.trim(),
    source,
    path,
  }
}

function lowerArray(v: readonly string[] | undefined): readonly string[] | undefined {
  return v?.map((s) => s.toLowerCase())
}

// ─── Loading ────────────────────────────────────────────────────────────────

function loadFromDir(dir: string, source: "user" | "workspace"): Agent[] {
  if (!existsSync(dir)) return []
  const out: Agent[] = []
  for (const entry of readdirSync(dir)) {
    const agentPath = join(dir, entry, "AGENT.md")
    if (!existsSync(agentPath)) continue
    try {
      if (!statSync(join(dir, entry)).isDirectory()) continue
      const raw = readFileSync(agentPath, "utf8")
      const { frontmatter, body } = parse(raw)
      out.push(buildAgent(frontmatter, body, entry, source, agentPath))
    } catch {
      // skip malformed agent
    }
  }
  return out
}

function parseDefaults(): Agent[] {
  const out: Agent[] = []
  for (const f of DEFAULT_AGENT_FILES) {
    try {
      const { frontmatter, body } = parse(f.raw)
      out.push(buildAgent(frontmatter, body, f.name, "default", `<default:${f.name}>`))
    } catch {
      // skip malformed default (shouldn't happen — they're shipped)
    }
  }
  return out
}

/**
 * Load all agents into a Map keyed by name. Precedence (later overrides):
 * repo defaults < user (`~/.omni/agents`) < workspace (`.omni/agents`).
 */
export function loadAgents(cwd?: string): Map<string, Agent> {
  const map = new Map<string, Agent>()
  for (const a of parseDefaults()) map.set(a.name, a)
  for (const a of loadFromDir(userAgentsDir(), "user")) map.set(a.name, a)
  const ws = workspacePaths(cwd)
  if (ws) {
    for (const a of loadFromDir(ws.agents, "workspace")) map.set(a.name, a)
  }
  return map
}

// ─── Permission enforcement (the real gate skills only pretended to have) ────

/** Field on a tool's args that permission regexes match against. */
const FIELD_BY_TOOL: Readonly<Record<string, string>> = {
  bash: "command",
  read_file: "path",
  write_file: "path",
  edit: "path",
  multi_edit: "path",
  web_fetch: "url",
  grep: "pattern",
  glob: "pattern",
}

function argMatcher(toolName: string, src: string): ((args: unknown) => boolean) | null {
  let re: RegExp
  try {
    re = new RegExp(src)
  } catch {
    return null // invalid regex → drop the rule (fail safe: gate stays restrictive)
  }
  const field = FIELD_BY_TOOL[toolName]
  return (args: unknown) => {
    if (typeof args !== "object" || args === null) return false
    const target = field
      ? (args as Record<string, unknown>)[field]
      : JSON.stringify(args)
    return typeof target === "string" && re.test(target)
  }
}

/**
 * Build a real {@link PermissionGate} from an agent's declared rules. Rule
 * order (first-match-wins in RuleBasedPermissions):
 *   1. destructive-bash deny (unless opted out)
 *   2. per-tool deny regexes
 *   3. per-tool allow regexes
 *   4. pass-through allow for listed tools with no explicit allow rules
 *   5. defaultDecision (agent.permissionDefault ?? "deny")
 *
 * A tool WITH allow rules is an allow-list: calls matching none fall through to
 * the default (deny). A tool with only deny rules is a denylist (rest allowed).
 */
export function agentPermissionGate(agent: Agent): PermissionGate {
  const rules: PermissionRule[] = []
  const tools = agent.tools ?? []
  const perms = agent.permissions ?? {}
  const bashInScope = tools.includes("bash") || "bash" in perms

  if (bashInScope && !agent.allowDestructive) {
    rules.push({ tool: "bash", when: looksDestructive, decision: "deny" })
  }

  for (const [toolName, rule] of Object.entries(perms)) {
    for (const src of rule.deny ?? []) {
      const when = argMatcher(toolName, src)
      if (when) rules.push({ tool: toolName, when, decision: "deny" })
    }
  }
  for (const [toolName, rule] of Object.entries(perms)) {
    for (const src of rule.allow ?? []) {
      const when = argMatcher(toolName, src)
      if (when) rules.push({ tool: toolName, when, decision: "allow" })
    }
  }
  for (const name of tools) {
    const hasAllow = (perms[name]?.allow?.length ?? 0) > 0
    if (!hasAllow) rules.push({ tool: name, decision: "allow" })
  }

  return new RuleBasedPermissions({
    rules,
    defaultDecision: agent.permissionDefault ?? "deny",
  })
}

// ─── Routing (suggest a specialized agent for a task) ────────────────────────

export interface RouteMatch {
  readonly agent: string
  readonly score: number
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Score each agent against a task string by counting language/domain hint hits
 * (word-boundary, case-insensitive). Returns matches sorted high→low; empty
 * when nothing matches (the caller falls back to the general engine).
 *
 * Routing only SUGGESTS an agent — the agent's permission gate is unchanged and
 * remains the security boundary. The main model still makes the final call.
 */
export function routeAgents(task: string, agents: Iterable<Agent>): readonly RouteMatch[] {
  const lower = task.toLowerCase()
  const out: RouteMatch[] = []
  for (const a of agents) {
    const hints = [...(a.languages ?? []), ...(a.domains ?? [])]
    let score = 0
    for (const h of hints) {
      if (new RegExp(`\\b${escapeRe(h)}\\b`).test(lower)) score++
    }
    if (score > 0) out.push({ agent: a.name, score })
  }
  return out.sort((x, y) => y.score - x.score)
}
