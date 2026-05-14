import { ulid } from "ulid"
import { resolve, dirname } from "node:path"
import { mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"

/**
 * A piece of long-term knowledge: a fact, preference, skill recipe, or
 * project convention. Memories are typed for retrieval and may carry tags.
 */
export interface MemoryEntry {
  readonly id: string
  readonly kind: MemoryKind
  readonly text: string
  readonly tags?: readonly string[]
  readonly source?: string
  readonly createdAt: number
}

export type MemoryKind = "fact" | "preference" | "skill" | "project" | "session"

/**
 * Long-term memory store across sessions. v1 is a simple JSON-on-disk
 * append-only log with linear-scan recall. Embedding-based retrieval is a
 * future upgrade (Aspect 9 / Aspect 8 evolve).
 */
export class Memory {
  private _entries: MemoryEntry[] = []
  private _loaded = false

  constructor(private readonly opts: { readonly path?: string } = {}) {}

  async load(): Promise<void> {
    if (this._loaded) return
    if (!this.opts.path) {
      this._loaded = true
      return
    }
    if (!existsSync(this.opts.path)) {
      this._loaded = true
      return
    }
    try {
      const raw = await Bun.file(this.opts.path).text()
      const parsed = JSON.parse(raw) as { entries: MemoryEntry[] }
      this._entries = parsed.entries ?? []
    } catch {
      // corrupt file — start fresh; preserve old via .bak
      try {
        await Bun.write(`${this.opts.path}.bak`, await Bun.file(this.opts.path).text())
      } catch {
        // ignore
      }
      this._entries = []
    }
    this._loaded = true
  }

  async add(
    entry: Omit<MemoryEntry, "id" | "createdAt"> & { readonly id?: string; readonly createdAt?: number },
  ): Promise<MemoryEntry> {
    await this.load()
    const e: MemoryEntry = {
      id: entry.id ?? ulid(),
      kind: entry.kind,
      text: entry.text,
      tags: entry.tags,
      source: entry.source,
      createdAt: entry.createdAt ?? Date.now(),
    }
    this._entries.push(e)
    await this.persist()
    return e
  }

  async remove(id: string): Promise<boolean> {
    await this.load()
    const before = this._entries.length
    this._entries = this._entries.filter((e) => e.id !== id)
    if (this._entries.length !== before) {
      await this.persist()
      return true
    }
    return false
  }

  /**
   * Linear scan recall. Returns entries matching `query` ranked by simple
   * keyword overlap, optionally filtered by kind and/or tag.
   */
  async recall(
    query: string,
    options: {
      readonly kind?: MemoryKind | readonly MemoryKind[]
      readonly tag?: string
      readonly limit?: number
    } = {},
  ): Promise<readonly MemoryEntry[]> {
    await this.load()
    const limit = options.limit ?? 10
    const kindFilter = options.kind
      ? new Set(Array.isArray(options.kind) ? options.kind : [options.kind])
      : null
    const tokens = tokenize(query)

    const scored: Array<{ e: MemoryEntry; score: number }> = []
    const haveQuery = tokens.length > 0
    for (const e of this._entries) {
      if (kindFilter && !kindFilter.has(e.kind)) continue
      if (options.tag && !(e.tags ?? []).includes(options.tag)) continue
      const score = relevance(tokens, e)
      if (!haveQuery) {
        // No query → treat filters as the search and order by recency.
        scored.push({ e, score: e.createdAt })
      } else if (score > 0) {
        scored.push({ e, score })
      }
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map((s) => s.e)
  }

  async all(): Promise<readonly MemoryEntry[]> {
    await this.load()
    return this._entries
  }

  async clear(): Promise<void> {
    this._entries = []
    await this.persist()
  }

  private async persist(): Promise<void> {
    if (!this.opts.path) return
    const dir = dirname(resolve(this.opts.path))
    await mkdir(dir, { recursive: true })
    await Bun.write(this.opts.path, JSON.stringify({ entries: this._entries }, null, 2))
  }
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((w) => w.length >= 3)
}

function relevance(queryTokens: readonly string[], entry: MemoryEntry): number {
  if (queryTokens.length === 0) return 0
  const haystack = (entry.text + " " + (entry.tags?.join(" ") ?? "")).toLowerCase()
  let score = 0
  for (const t of queryTokens) {
    if (haystack.includes(t)) score++
  }
  return score
}
