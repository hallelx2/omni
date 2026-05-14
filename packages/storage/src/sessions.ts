import type { Storage } from "./db.ts"

export type SessionStatus = "active" | "completed" | "failed" | "aborted"

export interface SessionRow {
  readonly id: string
  readonly model_id: string
  readonly status: SessionStatus
  readonly created_at: number
  readonly updated_at: number
  readonly meta?: Readonly<Record<string, unknown>>
}

export class SessionsRepo {
  constructor(private readonly store: Storage) {}

  create(id: string, modelId: string, meta?: Record<string, unknown>): SessionRow {
    const now = Date.now()
    this.store.db
      .query(
        `INSERT INTO sessions (id, model_id, status, created_at, updated_at, meta_json)
         VALUES (?, ?, 'active', ?, ?, ?)`,
      )
      .run(id, modelId, now, now, meta ? JSON.stringify(meta) : null)
    return { id, model_id: modelId, status: "active", created_at: now, updated_at: now, meta }
  }

  get(id: string): SessionRow | null {
    const row = this.store.db
      .query("SELECT * FROM sessions WHERE id = ?")
      .get(id) as
      | {
          id: string
          model_id: string
          status: SessionStatus
          created_at: number
          updated_at: number
          meta_json: string | null
        }
      | null
    if (!row) return null
    return {
      id: row.id,
      model_id: row.model_id,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      meta: row.meta_json ? (JSON.parse(row.meta_json) as Record<string, unknown>) : undefined,
    }
  }

  setStatus(id: string, status: SessionStatus): void {
    this.store.db
      .query("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, Date.now(), id)
  }

  list(opts: { readonly limit?: number; readonly status?: SessionStatus } = {}): readonly SessionRow[] {
    const limit = opts.limit ?? 50
    const stmt = opts.status
      ? this.store.db.query(
          "SELECT * FROM sessions WHERE status = ? ORDER BY updated_at DESC LIMIT ?",
        )
      : this.store.db.query("SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?")
    const rows = opts.status ? stmt.all(opts.status, limit) : stmt.all(limit)
    return (rows as Array<{
      id: string
      model_id: string
      status: SessionStatus
      created_at: number
      updated_at: number
      meta_json: string | null
    }>).map((r) => ({
      id: r.id,
      model_id: r.model_id,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      meta: r.meta_json ? (JSON.parse(r.meta_json) as Record<string, unknown>) : undefined,
    }))
  }

  delete(id: string): boolean {
    const r = this.store.db.query("DELETE FROM sessions WHERE id = ?").run(id)
    return r.changes > 0
  }
}
