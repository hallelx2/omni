import type { StoredVariant } from "@omni/storage"
import type { PromptVariant, VariantPool } from "./evolve.ts"

/**
 * Pure conversions between the persisted {@link StoredVariant} rows and the
 * in-memory {@link VariantPool} the evolution functions operate on. Keeps
 * `evolve.ts` storage-free and the bootstrap wiring thin.
 */

/** One stored row → a {@link PromptVariant} (drops model_id; that's the pool's scope). */
export function variantFromRow(row: StoredVariant): PromptVariant {
  return {
    id: row.id,
    text: row.text,
    parent: row.parent,
    trials: row.trials,
    successScore: row.success_score,
    createdAt: row.created_at,
  }
}

/** A {@link PromptVariant} + its model → a persistable {@link StoredVariant}. */
export function rowFromVariant(modelId: string, v: PromptVariant): StoredVariant {
  return {
    id: v.id,
    model_id: modelId,
    text: v.text,
    parent: v.parent,
    trials: v.trials,
    success_score: v.successScore,
    created_at: v.createdAt,
  }
}

/** Hydrate a {@link VariantPool} from one model's stored rows. */
export function poolFromRows(rows: readonly StoredVariant[]): VariantPool {
  return { variants: rows.map(variantFromRow) }
}
