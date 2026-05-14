import type { Storage } from "./db.ts"

export interface StoredVariant {
  readonly id: string
  readonly text: string
  readonly parent?: string
  readonly trials: number
  readonly success_score: number
  readonly created_at: number
}

export class VariantsRepo {
  constructor(private readonly store: Storage) {}

  upsert(v: StoredVariant): void {
    this.store.db
      .query(
        `INSERT INTO prompt_variants (id, text, parent, trials, success_score, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           text          = excluded.text,
           parent        = excluded.parent,
           trials        = excluded.trials,
           success_score = excluded.success_score`,
      )
      .run(v.id, v.text, v.parent ?? null, v.trials, v.success_score, v.created_at)
  }

  recordTrial(id: string, score: number): void {
    this.store.db
      .query(
        `UPDATE prompt_variants
         SET trials        = trials + 1,
             success_score = success_score + ?
         WHERE id = ?`,
      )
      .run(score, id)
  }

  get(id: string): StoredVariant | null {
    const row = this.store.db
      .query("SELECT * FROM prompt_variants WHERE id = ?")
      .get(id) as
      | { id: string; text: string; parent: string | null; trials: number; success_score: number; created_at: number }
      | null
    if (!row) return null
    return {
      id: row.id,
      text: row.text,
      parent: row.parent ?? undefined,
      trials: row.trials,
      success_score: row.success_score,
      created_at: row.created_at,
    }
  }

  /** All variants sorted by fitness (mean score) descending. */
  ranked(): readonly StoredVariant[] {
    const rows = this.store.db
      .query(
        `SELECT *, CASE WHEN trials = 0 THEN 0 ELSE success_score / trials END AS fitness
         FROM prompt_variants
         ORDER BY fitness DESC, created_at DESC`,
      )
      .all() as Array<{ id: string; text: string; parent: string | null; trials: number; success_score: number; created_at: number }>
    return rows.map((r) => ({
      id: r.id,
      text: r.text,
      parent: r.parent ?? undefined,
      trials: r.trials,
      success_score: r.success_score,
      created_at: r.created_at,
    }))
  }
}
