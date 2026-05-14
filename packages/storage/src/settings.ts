import type { Storage } from "./db.ts"

export class SettingsRepo {
  constructor(private readonly store: Storage) {}

  set(key: string, value: unknown): void {
    this.store.db
      .query(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, JSON.stringify(value))
  }

  get<T = unknown>(key: string): T | null {
    const row = this.store.db
      .query("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | null
    if (!row) return null
    try {
      return JSON.parse(row.value) as T
    } catch {
      return null
    }
  }

  delete(key: string): boolean {
    return this.store.db.query("DELETE FROM settings WHERE key = ?").run(key).changes > 0
  }

  all(): Readonly<Record<string, unknown>> {
    const rows = this.store.db.query("SELECT key, value FROM settings").all() as Array<{
      key: string
      value: string
    }>
    const out: Record<string, unknown> = {}
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.value)
      } catch {
        out[r.key] = r.value
      }
    }
    return out
  }
}
