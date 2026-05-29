import type { Storage } from "./db.ts"

/**
 * A persisted prompt-evolution variant. Each row belongs to one model
 * (`model_id`) and carries a running estimate of its quality: `trials` is how
 * many sessions ran on it, `success_score` is the summed trace score. Fitness
 * is the mean (`success_score / trials`).
 */
export interface StoredVariant {
  readonly id: string
  readonly model_id: string
  readonly text: string
  readonly parent?: string
  readonly trials: number
  readonly success_score: number
  readonly created_at: number
}

interface VariantRow {
  id: string
  model_id: string
  text: string
  parent: string | null
  trials: number
  success_score: number
  created_at: number
}

function mapRow(r: VariantRow): StoredVariant {
  return {
    id: r.id,
    model_id: r.model_id,
    text: r.text,
    parent: r.parent ?? undefined,
    trials: r.trials,
    success_score: r.success_score,
    created_at: r.created_at,
  }
}

/**
 * Model-scoped store for prompt-evolution variants (the `prompt_variants`
 * table, model_id added in migration 5). Variant ids are ULIDs — globally
 * unique — so {@link recordTrial} and {@link get} key on id alone, while
 * pool reads ({@link forModel}, {@link ranked}) are scoped to one model.
 */
export class VariantsRepo {
  constructor(private readonly store: Storage) {}

  /** Insert-or-update one variant (keyed by its globally-unique id). */
  upsert(v: StoredVariant): void {
    this.store.db
      .query(
        `INSERT INTO prompt_variants (id, model_id, text, parent, trials, success_score, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           model_id      = excluded.model_id,
           text          = excluded.text,
           parent        = excluded.parent,
           trials        = excluded.trials,
           success_score = excluded.success_score`,
      )
      .run(v.id, v.model_id, v.text, v.parent ?? null, v.trials, v.success_score, v.created_at)
  }

  /** Atomically fold one trial outcome (a trace score) into a variant. */
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
      .get(id) as VariantRow | null
    return row ? mapRow(row) : null
  }

  /** All variants for one model, oldest first (created_at asc). Powers the VariantPool. */
  forModel(modelId: string): readonly StoredVariant[] {
    const rows = this.store.db
      .query("SELECT * FROM prompt_variants WHERE model_id = ? ORDER BY created_at ASC")
      .all(modelId) as VariantRow[]
    return rows.map(mapRow)
  }

  /** One model's variants sorted by fitness (mean score) descending — for /evolve. */
  ranked(modelId: string): readonly StoredVariant[] {
    const rows = this.store.db
      .query(
        `SELECT *, CASE WHEN trials = 0 THEN 0 ELSE success_score / trials END AS fitness
         FROM prompt_variants
         WHERE model_id = ?
         ORDER BY fitness DESC, created_at DESC`,
      )
      .all(modelId) as VariantRow[]
    return rows.map(mapRow)
  }
}
