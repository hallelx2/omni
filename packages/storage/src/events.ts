import type { Storage } from "./db.ts"

export interface StoredEvent {
  readonly session_id: string
  readonly t: number
  readonly type: string
  readonly data: unknown
}

export class EventsRepo {
  constructor(private readonly store: Storage) {}

  append(e: StoredEvent): void {
    this.store.db
      .query("INSERT INTO events (session_id, t, type, data_json) VALUES (?, ?, ?, ?)")
      .run(e.session_id, e.t, e.type, JSON.stringify(e.data))
  }

  bySession(sessionId: string, opts: { readonly limit?: number } = {}): readonly StoredEvent[] {
    const limit = opts.limit ?? 10_000
    const rows = this.store.db
      .query("SELECT * FROM events WHERE session_id = ? ORDER BY t ASC LIMIT ?")
      .all(sessionId, limit) as Array<{
      session_id: string
      t: number
      type: string
      data_json: string
    }>
    return rows.map((r) => ({
      session_id: r.session_id,
      t: r.t,
      type: r.type,
      data: JSON.parse(r.data_json) as unknown,
    }))
  }

  countByType(sessionId: string): Readonly<Record<string, number>> {
    const rows = this.store.db
      .query("SELECT type, COUNT(*) AS n FROM events WHERE session_id = ? GROUP BY type")
      .all(sessionId) as Array<{ type: string; n: number }>
    const out: Record<string, number> = {}
    for (const r of rows) out[r.type] = r.n
    return out
  }
}
