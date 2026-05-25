import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { EmbeddingModel } from "ai"

/** Config for building a text-embedding model. */
export interface EmbeddingModelConfig {
  /** Model id as the provider expects (e.g. "text-embedding-3-small", "nomic-embed-text"). */
  readonly model: string
  /** Base URL for OpenAI-compatible providers (Ollama, MiMo, vLLM, LM Studio…). */
  readonly baseURL?: string
  /** API key (optional for local servers like Ollama). */
  readonly apiKey?: string
}

/**
 * Build an AI SDK text-embedding model for long-term memory (`VectorMemory`).
 * Mirrors the chat adapters' provider split:
 *   - `"openai"`                                  → `@ai-sdk/openai`
 *   - `"ollama" | "mimo" | "openai-compatible"`   → `@ai-sdk/openai-compatible`
 *
 * Throws on an unknown provider, or a missing `baseURL` where one is required,
 * so callers can surface a clear startup warning rather than failing mid-recall.
 */
export function embeddingModelFor(
  provider: string,
  config: EmbeddingModelConfig,
): EmbeddingModel {
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey: config.apiKey }).textEmbeddingModel(config.model)
    case "ollama":
    case "mimo":
    case "openai-compatible": {
      if (!config.baseURL) {
        throw new Error(`embedding provider "${provider}" requires a baseURL`)
      }
      return createOpenAICompatible({
        name: provider,
        baseURL: config.baseURL,
        apiKey: config.apiKey,
      }).textEmbeddingModel(config.model)
    }
    default:
      throw new Error(`unknown embedding provider "${provider}"`)
  }
}
