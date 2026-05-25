import { streamText } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
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

export type AnthropicModel =
  | "claude-opus-4-5"
  | "claude-sonnet-4-5"
  | "claude-haiku-4-5"
  | "claude-opus-4-7"
  | "claude-sonnet-4-6"
  | (string & {})

export interface AnthropicAdapterConfig {
  readonly apiKey: string
  readonly model: AnthropicModel
  readonly baseURL?: string
  readonly capabilities?: Partial<ModelCapabilities>
  readonly fetch?: typeof fetch
  readonly id?: string
  readonly name?: string
  /**
   * Enable extended thinking. When set, the adapter passes Anthropic's
   * thinking config via `providerOptions`. Surfaces as `model.thinking_delta`
   * events when the model uses reasoning.
   */
  readonly thinking?: {
    readonly enabled: boolean
    /** Token budget for thinking output. Default 1024. */
    readonly budgetTokens?: number
  }
}

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  contextWindow: 200_000,
  maxOutputTokens: 8_192,
  supportsToolCalls: true,
  supportsStreaming: true,
  supportsParallelToolCalls: true,
  supportsThinking: true,
}

/** Approximate USD per 1k tokens. Override via `capabilities` for accuracy. */
const ANTHROPIC_RATES: Record<string, { input: number; output: number }> = {
  "claude-opus-4-5": { input: 0.015, output: 0.075 },
  "claude-sonnet-4-5": { input: 0.003, output: 0.015 },
  "claude-haiku-4-5": { input: 0.001, output: 0.005 },
  "claude-opus-4-7": { input: 0.015, output: 0.075 },
  "claude-sonnet-4-6": { input: 0.003, output: 0.015 },
}

/**
 * Native Anthropic Claude adapter via `@ai-sdk/anthropic`.
 *
 * @example
 * ```ts
 * import { AnthropicAdapter } from "@omni/adapters"
 * const adapter = new AnthropicAdapter({
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 *   model: "claude-sonnet-4-5",
 * })
 * ```
 */
export class AnthropicAdapter implements ModelAdapter {
  readonly id: string
  readonly name: string
  readonly capabilities: ModelCapabilities
  private readonly _model: ReturnType<ReturnType<typeof createAnthropic>>
  private readonly _thinking?: AnthropicAdapterConfig["thinking"]

  constructor(config: AnthropicAdapterConfig) {
    this._thinking = config.thinking
    this.id = config.id ?? `anthropic:${config.model}`
    this.name = config.name ?? config.model
    const rates = ANTHROPIC_RATES[config.model]
    this.capabilities = {
      ...DEFAULT_CAPABILITIES,
      ...(rates ? { costPer1kInput: rates.input, costPer1kOutput: rates.output } : {}),
      ...config.capabilities,
    }

    const provider = createAnthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      fetch: config.fetch,
    })
    this._model = provider(config.model)
  }

  async *complete(params: CompleteParams): AsyncIterable<ModelEvent> {
    const providerOptions = this._thinking?.enabled
      ? {
          anthropic: {
            thinking: {
              type: "enabled" as const,
              budgetTokens: this._thinking.budgetTokens ?? 1024,
            },
          },
        }
      : undefined
    const result = streamText({
      model: this._model,
      messages: messagesToAISDK(params.messages),
      tools: toolsToAISDK(params.tools),
      temperature: params.temperature,
      abortSignal: params.signal,
      allowSystemInMessages: true,
      ...(providerOptions ? { providerOptions } : {}),
    })
    yield* withCost(translateStream(result.fullStream), this.capabilities)
  }

  languageModel(): unknown {
    return this._model
  }
}
