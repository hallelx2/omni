import type { Storage } from "./db.ts"

export interface StoredAudit {
  readonly id?: number
  readonly session_id?: string
  readonly tool: string
  readonly decision: "allow" | "deny"
  readonly args: unknown
  readonly timestamp: number
}

export class AuditRepo {
  constructor(private readonly store: Storage) {}

  append(a: StoredAudit): void {
    this.store.db
      .query(
        "INSERT INTO audit_log (session_id, tool, decision, args_json, timestamp) VALUES (?, ?, ?, ?, ?)",
      )
      .run(a.session_id ?? null, a.tool, a.decision, JSON.stringify(a.args), a.timestamp)
  }

  list(opts: { readonly sessionId?: string; readonly limit?: number } = {}): readonly StoredAudit[] {
    const limit = opts.limit ?? 200
    const stmt = opts.sessionId
      ? this.store.db.query(
          "SELECT * FROM audit_log WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?",
        )
      : this.store.db.query("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?")
    const rows = opts.sessionId ? stmt.all(opts.sessionId, limit) : stmt.all(limit)
    return (rows as Array<{
      id: number
      session_id: string | null
      tool: string
      decision: "allow" | "deny"
      args_json: string
      timestamp: number
    }>).map((r) => ({
      id: r.id,
      session_id: r.session_id ?? undefined,
      tool: r.tool,
      decision: r.decision,
      args: JSON.parse(r.args_json) as unknown,
      timestamp: r.timestamp,
    }))
  }
}
