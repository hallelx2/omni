/**
 * Runtime wiring for long-term memory (embedding-backed {@link VectorMemory}).
 * Lives in the CLI (not `@omni/improve`) because constructing an embedding
 * model needs `@omni/adapters`, which improve must not depend on — the same
 * layering rule the subagent runtime follows.
 *
 * Three pieces: resolve an embedding model from a "provider:model" ref, build a
 * VectorMemory when config enables it, and the `remember` tool + recall block
 * the turn loop uses. Memory is strictly opt-in (config.memory.enabled): when
 * off, none of this runs and behaviour is unchanged.
 */
import { z } from "zod"
import { embeddingModelFor } from "@omni/adapters"
import { resolveApiKey, resolveBaseURL, type Config, type Tool, type ToolContext } from "@omni/core"
import { VectorMemory, type VectorMemoryConfig } from "@omni/improve"
import type { VectorMemoryRepo } from "@omni/storage"
import type { EmbeddingModel } from "ai"

/**
 * Resolve a "provider:model" embedding ref to an AI SDK model. Supports the
 * providers that have config slots: `openai`, `ollama`, `mimo`. Throws (with a
 * clear message) on a malformed ref or unsupported provider so {@link buildMemory}
 * can degrade to "no memory" + a warning rather than crash.
 */
export function resolveEmbeddingModel(ref: string, config: Config): EmbeddingModel {
  const idx = ref.indexOf(":")
  if (idx <= 0) throw new Error(`memory.embeddingModel must be "provider:model" (got "${ref}")`)
  const provider = ref.slice(0, idx)
  const model = ref.slice(idx + 1)
  if (!model) throw new Error(`memory.embeddingModel is missing a model after ":" (got "${ref}")`)

  switch (provider) {
    case "openai":
      return embeddingModelFor("openai", { model, apiKey: resolveApiKey("openai", config) })
    case "ollama":
      return embeddingModelFor("ollama", {
        model,
        // resolveBaseURL only returns a configured value; the localhost default
        // lives in the ollama() adapter factory, so mirror it here.
        baseURL: resolveBaseURL("ollama", config) ?? "http://localhost:11434/v1",
      })
    case "mimo":
      return embeddingModelFor("mimo", {
        model,
        baseURL: resolveBaseURL("mimo", config),
        apiKey: resolveApiKey("mimo", config),
      })
    default:
      throw new Error(`unsupported embedding provider "${provider}" (use openai, ollama, or mimo)`)
  }
}

/**
 * Build long-term memory from config, or `null` when disabled / misconfigured.
 * Never throws: a bad embedding ref becomes a warning + `null` so startup
 * proceeds with memory simply off.
 */
export function buildMemory(
  config: Config,
  repo: VectorMemoryRepo,
  warn?: (msg: string) => void,
): VectorMemory | null {
  const m = config.memory
  if (!m?.enabled) return null
  if (!m.embeddingModel) {
    warn?.("memory.enabled is set but memory.embeddingModel is missing — memory disabled")
    return null
  }
  try {
    const model = resolveEmbeddingModel(m.embeddingModel, config)
    // `@omni/adapters` + cli resolve ai@6 (EmbeddingModel non-generic) while
    // `@omni/improve` (VectorMemory) still has nested ai@4 (generic). The
    // runtime objects are interchangeable; bridge the type identities here.
    return new VectorMemory({ repo, model: model as unknown as VectorMemoryConfig["model"] })
  } catch (e) {
    warn?.(`memory disabled: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

// ─── Capture (tool) + recall (turn-loop block) ───────────────────────────────

/** Minimal structural view of memory writes — lets tests inject a fake. */
export interface MemoryWriter {
  add(opts: {
    kind: string
    text: string
    tags?: readonly string[]
    source?: string
  }): Promise<unknown>
}

/** Minimal structural view of memory reads — lets tests inject a fake. */
export interface MemoryHit {
  readonly entry: { readonly text: string; readonly kind: string }
  readonly score: number
}
export interface MemoryReader {
  recall(query: string, opts?: { k?: number; minScore?: number }): Promise<readonly MemoryHit[]>
}

const RememberArgs = z.object({
  text: z.string().min(1).describe("The fact, preference, or lesson to remember for future sessions."),
  kind: z
    .string()
    .optional()
    .describe("Category: 'fact' | 'preference' | 'lesson' (default 'fact')."),
  tags: z.array(z.string()).optional().describe("Optional tags for later filtering."),
})

/**
 * The `remember` tool: lets the model persist a durable fact to long-term
 * memory. `permission: "auto"` — it only writes to the user's own memory store.
 */
export function makeRememberTool(
  mem: MemoryWriter,
): Tool<{ text: string; kind?: string; tags?: string[] }, { stored: true; kind: string; text: string }> {
  return {
    name: "remember",
    description:
      "Save a durable fact, preference, or lesson to long-term memory for recall in future sessions. " +
      "Use sparingly — only for genuinely reusable information, not transient task details.",
    permission: "auto",
    schema: RememberArgs,
    async execute(args, _ctx: ToolContext) {
      const kind = args.kind ?? "fact"
      await mem.add({ kind, text: args.text, tags: args.tags, source: "remember-tool" })
      return { stored: true, kind, text: args.text }
    },
  }
}

/**
 * Recall memories relevant to `query` and render them as a system-prompt block,
 * or `null` when there's nothing to inject. Recall failure (e.g. embedding
 * endpoint down) is swallowed — memory must never break a turn.
 */
export async function recallBlock(
  mem: MemoryReader,
  query: string,
  opts: { k?: number; minScore?: number } = {},
): Promise<string | null> {
  if (!query.trim()) return null
  let hits: readonly MemoryHit[]
  try {
    hits = await mem.recall(query, { k: opts.k ?? 5, minScore: opts.minScore ?? 0.3 })
  } catch {
    return null
  }
  if (hits.length === 0) return null
  const lines = hits.map((h) => `- (${h.entry.kind}) ${h.entry.text}`)
  return "Relevant long-term memory (recalled from earlier sessions):\n" + lines.join("\n")
}
