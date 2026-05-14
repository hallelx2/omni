import type { Storage } from "./db.ts"

export class ProfilesRepo {
  constructor(private readonly store: Storage) {}

  upsert(modelId: string, profile: unknown, probedAt = Date.now()): void {
    this.store.db
      .query(
        `INSERT INTO model_profiles (model_id, profile_json, probed_at)
         VALUES (?, ?, ?)
         ON CONFLICT(model_id) DO UPDATE SET
           profile_json = excluded.profile_json,
           probed_at    = excluded.probed_at`,
      )
      .run(modelId, JSON.stringify(profile), probedAt)
  }

  get<T = unknown>(modelId: string): { profile: T; probed_at: number } | null {
    const row = this.store.db
      .query("SELECT profile_json, probed_at FROM model_profiles WHERE model_id = ?")
      .get(modelId) as { profile_json: string; probed_at: number } | null
    if (!row) return null
    return { profile: JSON.parse(row.profile_json) as T, probed_at: row.probed_at }
  }

  list(): readonly { model_id: string; profile: unknown; probed_at: number }[] {
    const rows = this.store.db
      .query("SELECT * FROM model_profiles ORDER BY probed_at DESC")
      .all() as Array<{ model_id: string; profile_json: string; probed_at: number }>
    return rows.map((r) => ({
      model_id: r.model_id,
      profile: JSON.parse(r.profile_json) as unknown,
      probed_at: r.probed_at,
    }))
  }
}
