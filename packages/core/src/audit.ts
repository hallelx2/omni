import type { Tool, ToolCall } from "./types.ts"
import type { PermissionDecision } from "./permissions.ts"

/** A single audit entry. Pluggable consumers persist or stream these. */
export interface AuditRecord {
  readonly timestamp: number
  readonly sessionId: string
  readonly toolName: string
  readonly decision: PermissionDecision
  readonly call: ToolCall
  readonly reason?: string
}

/**
 * Receives every permission decision the engine asks about.
 *
 * Implementations may persist (SQLite, file), forward (Slack, Datadog), or
 * just accumulate in memory for inspection. Should not throw — log internally
 * on failure.
 */
export interface AuditLog {
  record(entry: AuditRecord): void | Promise<void>
}

/** Simple in-memory audit log. Useful for tests and dev inspection. */
export class InMemoryAuditLog implements AuditLog {
  private readonly _entries: AuditRecord[] = []
  record(entry: AuditRecord): void {
    this._entries.push(entry)
  }
  entries(): readonly AuditRecord[] {
    return this._entries
  }
  clear(): void {
    this._entries.length = 0
  }
}

/** Console audit log — handy when developing without storage wired up. */
export class ConsoleAuditLog implements AuditLog {
  constructor(private readonly prefix = "[audit]") {}
  record(entry: AuditRecord): void {
    const args = typeof entry.call.args === "string" ? entry.call.args : JSON.stringify(entry.call.args)
    // eslint-disable-next-line no-console
    console.log(
      `${this.prefix} ${new Date(entry.timestamp).toISOString()} ${entry.decision} ${entry.toolName}(${args})`,
    )
  }
}

/** No-op for hot paths where auditing is opt-in. */
export const NullAuditLog: AuditLog = { record() {} }

// Re-export for permission gates to consume without circular imports.
export type { Tool, ToolCall, PermissionDecision }
