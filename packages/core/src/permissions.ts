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
