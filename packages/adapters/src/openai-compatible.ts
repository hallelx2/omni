import { streamText } from "ai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type {
  CompleteParams,
  ModelAdapter,
  ModelCapabilities,
  ModelEvent,
} from "@omni/core"
import { messagesToAISDK } from "./util/messages.ts"
import { toolsToAISDK } from "./util/tools.ts"
import { translateStream } from "./util/stream.ts"
import { withCost } from "./util/cost.ts"

export interface OpenAICompatibleAdapterConfig {
  /** Base URL of an OpenAI-compatible /v1 endpoint (MiMo, Ollama, OpenRouter, vLLM, LM Studio). */
  readonly baseURL: string
  /** API key. Optional for local servers like Ollama. */
  readonly apiKey?: string
  /** Model identifier as the provider expects it (e.g. "mimo-v2.5-pro", "qwen2.5-coder:7b"). */
  readonly model: string
  /** Provider identifier (free-form; used by the AI SDK provider factory). */
  readonly providerName?: string
  /** Stable adapter id surfaced in events. Defaults to `${providerName}:${model}`. */
  readonly id?: string
  /** Human-readable name. */
  readonly name?: string
  /** Capability overrides. Defaults are conservative for self-hosted open models. */
  readonly capabilities?: Partial<ModelCapabilities>
  /** Optional `fetch` override (testing or auth proxies). */
  readonly fetch?: typeof fetch
  /** Default request headers (e.g. `Authorization`, custom org headers). */
  readonly headers?: Readonly<Record<string, string>>
}

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  contextWindow: 32_768,
  supportsToolCalls: true,
  supportsStreaming: true,
  supportsParallelToolCalls: true,
}

/**
 * Generic adapter for any OpenAI Chat Completions-compatible endpoint.
 * Covers MiMo, Ollama, OpenRouter, vLLM, LM Studio, Together, DeepInfra, etc.
 * For provider-specific feature surfacing use a dedicated adapter
 * (e.g. {@link AnthropicAdapter} for native Claude features).
 */
export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly id: string
  readonly name: string
  readonly capabilities: ModelCapabilities
  private readonly _model: ReturnType<ReturnType<typeof createOpenAICompatible>>
  private readonly _modelName: string

  constructor(config: OpenAICompatibleAdapterConfig) {
    const providerName = config.providerName ?? "openai-compatible"
    this._modelName = config.model
    this.id = config.id ?? `${providerName}:${config.model}`
    this.name = config.name ?? config.model
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...config.capabilities }

    const provider = createOpenAICompatible({
      name: providerName,
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      fetch: config.fetch,
      headers: config.headers as Record<string, string> | undefined,
    })
    this._model = provider(config.model)
  }

  async *complete(params: CompleteParams): AsyncIterable<ModelEvent> {
    const result = streamText({
      model: this._model,
      messages: messagesToAISDK(params.messages),
      tools: toolsToAISDK(params.tools),
      temperature: params.temperature,
      abortSignal: params.signal,
      allowSystemInMessages: true,
    })

    yield* withCost(translateStream(result.fullStream), this.capabilities)
  }
}
