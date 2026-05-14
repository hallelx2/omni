import {
  OpenAICompatibleAdapter,
  type OpenAICompatibleAdapterConfig,
} from "./openai-compatible.ts"
import type { ModelCapabilities } from "@omni/core"

export interface OllamaAdapterConfig {
  /** Model tag as installed locally (e.g. "qwen2.5-coder:7b", "llama3.2"). */
  readonly model: string
  /** Defaults to http://localhost:11434/v1. */
  readonly baseURL?: string
  readonly capabilities?: Partial<ModelCapabilities>
  readonly fetch?: typeof fetch
}

/**
 * Local Ollama adapter using the OpenAI-compatible endpoint Ollama exposes
 * at `/v1`. Useful for offline development with any model Ollama can serve.
 *
 * @example
 * ```ts
 * import { ollama } from "@omni/adapters"
 * const adapter = ollama({ model: "qwen2.5-coder:7b" })
 * ```
 */
export function ollama(config: OllamaAdapterConfig): OpenAICompatibleAdapter {
  const opts: OpenAICompatibleAdapterConfig = {
    providerName: "ollama",
    baseURL: config.baseURL ?? "http://localhost:11434/v1",
    apiKey: "ollama", // Ollama doesn't validate but the SDK requires a non-empty string
    model: config.model,
    name: config.model,
    capabilities: {
      contextWindow: 32_768,
      supportsToolCalls: true,
      supportsStreaming: true,
      supportsParallelToolCalls: false, // varies by model; opt-in via override
      ...config.capabilities,
    },
    fetch: config.fetch,
  }
  return new OpenAICompatibleAdapter(opts)
}
