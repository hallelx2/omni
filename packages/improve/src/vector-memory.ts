import { ulid } from "ulid"
import { embed, embedMany } from "ai"
import type { EmbeddingModel } from "ai"
import type { VectorMemoryRepo, VectorEntry } from "@omni/storage"

/**
 * Embedding-backed long-term memory. Uses the Vercel AI SDK's `embed`
 * helper to vectorise text, persists vectors in `vector_memory` (via
 * `@omni/storage`), and retrieves by cosine similarity.
 *
 * For 10K-scale corpora the linear scan is fast enough (~50ms). For larger
 * corpora swap the backing repo for one using `sqlite-vec` — the public
 * API here doesn't change.
 *
 * @example
 * ```ts
 * import { openai } from "@ai-sdk/openai"
 * const vm = new VectorMemory({
 *   repo,
 *   model: openai.embedding("text-embedding-3-small"),
 * })
 * await vm.add({ kind: "fact", text: "user prefers TypeScript strict mode", tags: ["preferences"] })
 * const hits = await vm.recall("which TS settings?")
 * ```
 */
export interface VectorMemoryConfig {
  readonly repo: VectorMemoryRepo
  readonly model: EmbeddingModel<string>
}

export interface AddOptions {
  readonly kind: string
  readonly text: string
  readonly tags?: readonly string[]
  readonly source?: string
  readonly id?: string
}

export interface RecallOptions {
  readonly k?: number
  readonly kind?: string
  readonly tag?: string
  /** Score floor — drop hits below this (range 0..1). Default 0.0. */
  readonly minScore?: number
}

export interface RecallHit {
  readonly entry: VectorEntry
  readonly score: number
}

export class VectorMemory {
  constructor(private readonly config: VectorMemoryConfig) {}

  async add(opts: AddOptions): Promise<VectorEntry> {
    const { embedding } = await embed({ model: this.config.model, value: opts.text })
    const vec = new Float32Array(embedding)
    return this.config.repo.insert({
      id: opts.id ?? ulid(),
      kind: opts.kind,
      text: opts.text,
      tags: opts.tags,
      embedding: vec,
      source: opts.source,
    })
  }

  /**
   * Batch insert. Uses `embedMany` so one HTTP request can carry many texts —
   * orders of magnitude cheaper at scale.
   */
  async addMany(entries: readonly AddOptions[]): Promise<readonly VectorEntry[]> {
    if (entries.length === 0) return []
    const { embeddings } = await embedMany({
      model: this.config.model,
      values: entries.map((e) => e.text),
    })
    const out: VectorEntry[] = []
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!
      const vec = new Float32Array(embeddings[i]!)
      out.push(
        this.config.repo.insert({
          id: e.id ?? ulid(),
          kind: e.kind,
          text: e.text,
          tags: e.tags,
          embedding: vec,
          source: e.source,
        }),
      )
    }
    return out
  }

  async recall(query: string, opts: RecallOptions = {}): Promise<readonly RecallHit[]> {
    if (!query.trim()) return []
    const { embedding } = await embed({ model: this.config.model, value: query })
    const vec = new Float32Array(embedding)
    const k = opts.k ?? 5
    const min = opts.minScore ?? 0
    const hits = this.config.repo.topK(vec, k, { kind: opts.kind, tag: opts.tag })
    return hits.filter((h) => h.score >= min)
  }

  remove(id: string): boolean {
    return this.config.repo.delete(id)
  }

  count(): number {
    return this.config.repo.count()
  }

  clear(): void {
    this.config.repo.clear()
  }

  list(opts: { readonly kind?: string; readonly limit?: number } = {}): readonly VectorEntry[] {
    return this.config.repo.list(opts)
  }
}
