import { streamText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
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

export type OpenAIModel = "gpt-4o" | "gpt-4o-mini" | "gpt-4-turbo" | "o1" | "o1-mini" | (string & {})

export interface OpenAIAdapterConfig {
  readonly apiKey: string
  readonly model: OpenAIModel
  readonly baseURL?: string
  readonly organization?: string
  readonly capabilities?: Partial<ModelCapabilities>
  readonly fetch?: typeof fetch
  readonly id?: string
  readonly name?: string
}

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  supportsToolCalls: true,
  supportsStreaming: true,
  supportsParallelToolCalls: true,
}

const OPENAI_RATES: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 0.0025, output: 0.01 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4-turbo": { input: 0.01, output: 0.03 },
  "o1": { input: 0.015, output: 0.06 },
  "o1-mini": { input: 0.003, output: 0.012 },
}

/** Native OpenAI adapter via `@ai-sdk/openai`. */
export class OpenAIAdapter implements ModelAdapter {
  readonly id: string
  readonly name: string
  readonly capabilities: ModelCapabilities
  private readonly _model: ReturnType<ReturnType<typeof createOpenAI>>

  constructor(config: OpenAIAdapterConfig) {
    this.id = config.id ?? `openai:${config.model}`
    this.name = config.name ?? config.model
    const rates = OPENAI_RATES[config.model]
    this.capabilities = {
      ...DEFAULT_CAPABILITIES,
      ...(rates ? { costPer1kInput: rates.input, costPer1kOutput: rates.output } : {}),
      ...config.capabilities,
    }

    const provider = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      organization: config.organization,
      fetch: config.fetch,
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

  languageModel(): unknown {
    return this._model
  }
}
