import { resolve } from "node:path"
import type { Tool, ToolCall } from "./types.ts"

/** Final decision returned by a {@link PermissionGate}. */
export type PermissionDecision = "allow" | "deny"

/**
 * Decides whether a validated tool call may execute.
 *
 * The engine emits `tool.permission_requested` before consulting the
 * gate (even when auto-allowed), so UIs can render an "asking" state
 * regardless of strategy. If the gate throws, the engine treats it as deny
 * and emits `engine.warning`.
 *
 * @example Wire an interactive gate to a CLI prompt
 * ```ts
 * import { AskPermissions } from "@omni/core"
 *
 * const gate = new AskPermissions(async (tool, call) => {
 *   const answer = await promptUser(`Run ${tool.name}? [y/n]`)
 *   return answer === "y" ? "allow" : "deny"
 * })
 * ```
 */
export interface PermissionGate {
  check(tool: Tool, call: ToolCall): Promise<PermissionDecision>
}

/** Allows every call. Useful for trusted contexts and tests. */
export class AllowAllPermissions implements PermissionGate {
  async check(): Promise<PermissionDecision> {
    return "allow"
  }
}

/** Denies every call. Useful as a safety default while wiring UIs. */
export class DenyAllPermissions implements PermissionGate {
  async check(): Promise<PermissionDecision> {
    return "deny"
  }
}

/**
 * Static per-tool defaults. Falls back to the tool's own `permission` field.
 *
 * @example Pre-approve bash but deny network tools by name
 * ```ts
 * new StaticPermissions({ bash: "allow", web_fetch: "deny" })
 * ```
 */
export class StaticPermissions implements PermissionGate {
  constructor(private readonly defaults: Readonly<Record<string, PermissionDecision>> = {}) {}
  async check(tool: Tool): Promise<PermissionDecision> {
    const override = this.defaults[tool.name]
    if (override) return override
    return tool.permission === "deny" ? "deny" : "allow"
  }
}

/** Handler signature an interactive gate delegates to (typically wired to a UI). */
export type AskHandler = (tool: Tool, call: ToolCall) => Promise<PermissionDecision>

/**
 * Honors each tool's declared posture: `auto` → allow, `deny` → deny,
 * `ask` → delegates to the handler. Used by interactive surfaces.
 */
export class AskPermissions implements PermissionGate {
  constructor(private readonly ask: AskHandler) {}
  async check(tool: Tool, call: ToolCall): Promise<PermissionDecision> {
    if (tool.permission === "auto") return "allow"
    if (tool.permission === "deny") return "deny"
    return this.ask(tool, call)
  }
}

// ─── Pattern-based allowlist / denylist ────────────────────────────────────

/** A rule entry: tool name match + optional args predicate. */
export interface PermissionRule {
  /** Tool name (string for exact, RegExp for pattern match, "*" for any). */
  readonly tool: string | RegExp
  /** Optional predicate over the call's args (raw, may be unvalidated). */
  readonly when?: (args: unknown) => boolean
  readonly decision: PermissionDecision
}

/**
 * Pattern-driven allowlist/denylist. Rules are evaluated in order; the
 * first match wins. If no rule matches, falls back to `defaultDecision`.
 *
 * @example
 * ```ts
 * new RuleBasedPermissions({
 *   defaultDecision: "deny",
 *   rules: [
 *     { tool: "read_file", decision: "allow" },
 *     { tool: "glob", decision: "allow" },
 *     { tool: "bash", when: (a) => /^echo /.test((a as any)?.command ?? ""), decision: "allow" },
 *   ],
 * })
 * ```
 */
export class RuleBasedPermissions implements PermissionGate {
  constructor(
    private readonly config: {
      readonly rules: readonly PermissionRule[]
      readonly defaultDecision?: PermissionDecision
    },
  ) {}
  async check(tool: Tool, call: ToolCall): Promise<PermissionDecision> {
    for (const r of this.config.rules) {
      if (!matchTool(r.tool, tool.name)) continue
      if (r.when && !safePredicate(r.when, call.args)) continue
      return r.decision
    }
    return this.config.defaultDecision ?? "deny"
  }
}

function matchTool(matcher: string | RegExp, name: string): boolean {
  if (matcher === "*") return true
  if (typeof matcher === "string") return matcher === name
  return matcher.test(name)
}

function safePredicate(fn: (args: unknown) => boolean, args: unknown): boolean {
  try {
    return fn(args)
  } catch {
    return false
  }
}

// ─── Bash command guard ────────────────────────────────────────────────────

/**
 * Sensible defaults for dangerous shell patterns. Use as the `when` predicate
 * of a deny rule on the `bash` tool.
 *
 * @example
 * ```ts
 * new RuleBasedPermissions({
 *   rules: [
 *     { tool: "bash", when: looksDestructive, decision: "deny" },
 *     { tool: "*", decision: "allow" },
 *   ],
 * })
 * ```
 */
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-rf?\s+\/(?!tmp\b|var\/tmp\b)/i, // rm -rf / (except /tmp)
  /\brm\s+-rf?\s+~/, // rm -rf ~
  /\bmkfs\b/i,
  /\bdd\s+if=.*\bof=\/dev\/(sd|nvme|hd)/i,
  /:\(\)\s*\{.*\}\s*;\s*:/, // fork bomb
  /\bchmod\s+-R\s+777\s+\//,
  /\bshutdown\b|\breboot\b|\bhalt\b/i,
  /\bcurl\s+[^|]*\|\s*(bash|sh)\b/i, // curl | sh
  /\bwget\s+[^|]*\|\s*(bash|sh)\b/i,
  />\s*\/dev\/(sd|nvme|hd)/i,
]

export function looksDestructive(args: unknown): boolean {
  if (typeof args !== "object" || args === null) return false
  const cmd = (args as { command?: unknown }).command
  if (typeof cmd !== "string") return false
  return DESTRUCTIVE_PATTERNS.some((p) => p.test(cmd))
}

// ─── Workspace confinement (per-path file + bash guards) ─────────────────────

/** Tool → the args field that carries a filesystem path (read/mutation tools). */
const PATH_FIELD_BY_TOOL: Readonly<Record<string, string>> = {
  read_file: "path",
  write_file: "path",
  edit: "path",
  multi_edit: "path",
}

function normalizePath(p: string): string {
  let s = resolve(p).replace(/\\/g, "/").replace(/\/+$/, "")
  if (process.platform === "win32") s = s.toLowerCase()
  return s.length > 0 ? s : "/"
}

/**
 * True when `target` resolves inside `root` (or equals it). Relative targets
 * are resolved against `root` — the confinement root, which the engine sets to
 * the workspace/cwd. Comparison is separator- and (on Windows) case-normalized
 * and respects path boundaries, so `/srv/app` does NOT contain `/srv/app-evil`.
 */
export function isWithinRoot(root: string, target: string): boolean {
  const r = normalizePath(root)
  const t = normalizePath(resolve(root, target))
  return t === r || t.startsWith(r + "/")
}

/** Deny predicate: the tool's path argument resolves outside `root`. */
function pathArgEscapes(root: string, field: string): (args: unknown) => boolean {
  return (args) => {
    if (typeof args !== "object" || args === null) return false
    const v = (args as Record<string, unknown>)[field]
    if (typeof v !== "string" || v.length === 0) return false
    return !isWithinRoot(root, v)
  }
}

/**
 * Best-effort deny predicate for `bash` commands that reach outside `root`.
 * Shell commands are opaque, so this is a heuristic — intentionally strict,
 * since workspace confinement is opt-in. It flags `~`/`$HOME`, any `cd`/`pushd`
 * whose target escapes `root`, and absolute-path tokens that resolve outside
 * `root`. False positives are possible; the model can rephrase using a relative
 * path inside the workspace.
 */
export function bashEscapesRoot(root: string): (args: unknown) => boolean {
  return (args) => {
    if (typeof args !== "object" || args === null) return false
    const cmd = (args as { command?: unknown }).command
    if (typeof cmd !== "string" || cmd.length === 0) return false
    if (/\$HOME\b|\$\{HOME\}/.test(cmd)) return true

    const tokens = cmd
      .split(/[\s;|&<>()]+/)
      .map((t) => t.replace(/^['"]+|['"]+$/g, ""))
      .filter((t) => t.length > 0)

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!
      if (tok === "~" || tok.startsWith("~/") || tok.startsWith("~\\")) return true
      const isAbs = /^(?:[A-Za-z]:[\\/]|[\\/])/.test(tok)
      if (isAbs && !isWithinRoot(root, tok)) return true
      if ((tok === "cd" || tok === "pushd") && tokens[i + 1]) {
        const target = tokens[i + 1]!
        if (target.startsWith("~") || !isWithinRoot(root, target)) return true
      }
    }
    return false
  }
}

export interface WorkspaceGuardOptions {
  /** Deny obviously destructive bash (rm -rf /, fork bombs, curl|sh). Default true. */
  readonly denyDestructiveBash?: boolean
  /** Confine file tools + bash to `root`. Default false (needs `root`). */
  readonly restrictToRoot?: boolean
  /** Confinement root (the workspace/cwd). Required when `restrictToRoot`. */
  readonly root?: string
}

/**
 * Build the deny-only guard rules that confine an agent to a workspace. Layer
 * these over any base gate with {@link GuardedPermissions}: the destructive-bash
 * guard is on by default; path confinement is opt-in.
 */
export function workspaceGuards(opts: WorkspaceGuardOptions): PermissionRule[] {
  const rules: PermissionRule[] = []
  if (opts.denyDestructiveBash !== false) {
    rules.push({ tool: "bash", when: looksDestructive, decision: "deny" })
  }
  if (opts.restrictToRoot && opts.root) {
    for (const [tool, field] of Object.entries(PATH_FIELD_BY_TOOL)) {
      rules.push({ tool, when: pathArgEscapes(opts.root, field), decision: "deny" })
    }
    rules.push({ tool: "bash", when: bashEscapesRoot(opts.root), decision: "deny" })
  }
  return rules
}

/**
 * Compose deny/allow guard rules in front of a base gate. The first guard whose
 * tool + `when` matches wins; if none match, the decision delegates to `inner`.
 * Put safety denies (destructive, out-of-root) before any convenience allows so
 * they can't be overridden.
 *
 * @example Deny destructive bash, auto-allow reads, otherwise ask
 * ```ts
 * new GuardedPermissions(askGate, [
 *   { tool: "bash", when: looksDestructive, decision: "deny" },
 *   { tool: "read_file", decision: "allow" },
 * ])
 * ```
 */
export class GuardedPermissions implements PermissionGate {
  constructor(
    private readonly inner: PermissionGate,
    private readonly guards: readonly PermissionRule[],
  ) {}
  async check(tool: Tool, call: ToolCall): Promise<PermissionDecision> {
    for (const g of this.guards) {
      if (!matchTool(g.tool, tool.name)) continue
      if (g.when && !safePredicate(g.when, call.args)) continue
      return g.decision
    }
    return this.inner.check(tool, call)
  }
}

export interface AllowlistOptions {
  /** Tool names that are permitted; everything else is denied. */
  readonly allow: readonly string[]
  /** Permit destructive bash even when `bash` is allowed. Default false. */
  readonly allowDestructiveBash?: boolean
  /** Optional workspace root to also confine file tools + bash. */
  readonly root?: string
}

/**
 * A deny-by-default gate that permits only the named tools — the building block
 * for an "allowlist" permission posture (CI / unattended automation).
 * Destructive bash stays denied even when `bash` is allowed (unless
 * `allowDestructiveBash`); pass `root` to confine file tools + bash to it.
 */
export function allowlistGate(opts: AllowlistOptions): PermissionGate {
  const guards = workspaceGuards({
    denyDestructiveBash: !opts.allowDestructiveBash,
    restrictToRoot: Boolean(opts.root),
    root: opts.root,
  })
  const allows: PermissionRule[] = opts.allow.map((tool) => ({ tool, decision: "allow" }))
  return new GuardedPermissions(new DenyAllPermissions(), [...guards, ...allows])
}

// ─── Auditing wrapper ──────────────────────────────────────────────────────

import type { AuditLog } from "./audit.ts"

/**
 * Wrap any {@link PermissionGate} with an audit log. Every decision is
 * forwarded to the inner gate and recorded.
 *
 * @example
 * ```ts
 * const log = new InMemoryAuditLog()
 * const gate = new AuditingPermissions(new AskPermissions(prompt), log, "session-1")
 * // ...
 * console.log(log.entries())
 * ```
 */
export class AuditingPermissions implements PermissionGate {
  constructor(
    private readonly inner: PermissionGate,
    private readonly log: AuditLog,
    private readonly sessionId = "",
  ) {}
  async check(tool: Tool, call: ToolCall): Promise<PermissionDecision> {
    const decision = await this.inner.check(tool, call)
    try {
      await this.log.record({
        timestamp: Date.now(),
        sessionId: this.sessionId,
        toolName: tool.name,
        decision,
        call,
      })
    } catch {
      // never let audit failure block the decision
    }
    return decision
  }
}
