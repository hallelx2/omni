import type { Storage } from "./db.ts"

/**
 * A single vector-memory entry: arbitrary text with an embedding vector.
 * The embedding is stored as packed float32 bytes for compactness; the
 * repo handles encode/decode.
 */
export interface VectorEntry {
  readonly id: string
  readonly kind: string
  readonly text: string
  readonly tags?: readonly string[]
  readonly embedding: Float32Array
  readonly source?: string
  readonly created_at: number
}

export interface VectorSearchHit {
  readonly entry: VectorEntry
  readonly score: number
}

/**
 * Repository for `vector_memory` (added in migration 4). Supports insert,
 * filter, top-K cosine-similarity search, count, and clear.
 *
 * The search is a linear scan + JS cosine — fine up to ~10K entries
 * (sub-50ms typical). For larger corpora swap in `sqlite-vec`; the API
 * here stays the same.
 */
export class VectorMemoryRepo {
  constructor(private readonly store: Storage) {}

  insert(entry: Omit<VectorEntry, "created_at"> & { readonly created_at?: number }): VectorEntry {
    const created_at = entry.created_at ?? Date.now()
    const buf = floatsToBuf(entry.embedding)
    this.store.db
      .query(
        `INSERT OR REPLACE INTO vector_memory
         (id, kind, text, tags_json, embedding, dim, source, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.kind,
        entry.text,
        entry.tags ? JSON.stringify(entry.tags) : null,
        buf,
        entry.embedding.length,
        entry.source ?? null,
        created_at,
      )
    return { ...entry, created_at }
  }

  delete(id: string): boolean {
    return this.store.db.query("DELETE FROM vector_memory WHERE id = ?").run(id).changes > 0
  }

  clear(): void {
    this.store.db.exec("DELETE FROM vector_memory")
  }

  count(): number {
    const row = this.store.db
      .query("SELECT COUNT(*) AS n FROM vector_memory")
      .get() as { n: number }
    return row.n
  }

  list(opts: { readonly kind?: string; readonly limit?: number } = {}): readonly VectorEntry[] {
    const limit = opts.limit ?? 100
    const stmt = opts.kind
      ? this.store.db.query(
          "SELECT * FROM vector_memory WHERE kind = ? ORDER BY created_at DESC LIMIT ?",
        )
      : this.store.db.query("SELECT * FROM vector_memory ORDER BY created_at DESC LIMIT ?")
    const rows = opts.kind ? stmt.all(opts.kind, limit) : stmt.all(limit)
    return (rows as Array<RawRow>).map(decodeRow)
  }

  /**
   * Linear-scan top-K cosine search. Returns hits sorted by descending
   * similarity. Optionally filter by `kind` and `tag` before scoring.
   */
  topK(
    query: Float32Array,
    k = 5,
    filter: { readonly kind?: string; readonly tag?: string } = {},
  ): readonly VectorSearchHit[] {
    const stmt = filter.kind
      ? this.store.db.query("SELECT * FROM vector_memory WHERE kind = ?")
      : this.store.db.query("SELECT * FROM vector_memory")
    const rows = (filter.kind ? stmt.all(filter.kind) : stmt.all()) as RawRow[]

    const qNorm = norm(query)
    if (qNorm === 0) return []

    const hits: VectorSearchHit[] = []
    for (const r of rows) {
      const e = decodeRow(r)
      if (filter.tag && !(e.tags ?? []).includes(filter.tag)) continue
      const score = cosineSim(query, e.embedding, qNorm)
      hits.push({ entry: e, score })
    }
    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, k)
  }
}

interface RawRow {
  id: string
  kind: string
  text: string
  tags_json: string | null
  embedding: Buffer | Uint8Array
  dim: number
  source: string | null
  created_at: number
}

function decodeRow(r: RawRow): VectorEntry {
  return {
    id: r.id,
    kind: r.kind,
    text: r.text,
    tags: r.tags_json ? (JSON.parse(r.tags_json) as readonly string[]) : undefined,
    embedding: bufToFloats(r.embedding, r.dim),
    source: r.source ?? undefined,
    created_at: r.created_at,
  }
}

function floatsToBuf(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
}

function bufToFloats(buf: Buffer | Uint8Array, dim: number): Float32Array {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  // Copy into an aligned ArrayBuffer for Float32Array safety
  const aligned = new ArrayBuffer(dim * 4)
  new Uint8Array(aligned).set(u8.subarray(0, dim * 4))
  return new Float32Array(aligned)
}

function norm(v: Float32Array): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  return Math.sqrt(s)
}

function cosineSim(a: Float32Array, b: Float32Array, aNorm?: number): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let bNorm = 0
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!
    bNorm += b[i]! * b[i]!
  }
  const na = aNorm ?? norm(a)
  const nb = Math.sqrt(bNorm)
  if (na === 0 || nb === 0) return 0
  return dot / (na * nb)
}
