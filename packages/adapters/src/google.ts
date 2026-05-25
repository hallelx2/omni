import { streamText } from "ai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
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

export type GoogleModel =
  | "gemini-2.0-flash"
  | "gemini-2.0-flash-thinking-exp"
  | "gemini-1.5-pro"
  | "gemini-1.5-flash"
  | (string & {})

export interface GoogleAdapterConfig {
  readonly apiKey: string
  readonly model: GoogleModel
  readonly baseURL?: string
  readonly capabilities?: Partial<ModelCapabilities>
  readonly fetch?: typeof fetch
  readonly id?: string
  readonly name?: string
}

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  contextWindow: 1_000_000,
  maxOutputTokens: 8_192,
  supportsToolCalls: true,
  supportsStreaming: true,
  supportsParallelToolCalls: true,
}

const GOOGLE_RATES: Record<string, { input: number; output: number }> = {
  "gemini-2.0-flash": { input: 0.00015, output: 0.0006 },
  "gemini-1.5-pro": { input: 0.00125, output: 0.005 },
  "gemini-1.5-flash": { input: 0.000075, output: 0.0003 },
}

/** Google Gemini adapter via `@ai-sdk/google`. */
export class GoogleAdapter implements ModelAdapter {
  readonly id: string
  readonly name: string
  readonly capabilities: ModelCapabilities
  private readonly _model: ReturnType<ReturnType<typeof createGoogleGenerativeAI>>

  constructor(config: GoogleAdapterConfig) {
    this.id = config.id ?? `google:${config.model}`
    this.name = config.name ?? config.model
    const rates = GOOGLE_RATES[config.model]
    this.capabilities = {
      ...DEFAULT_CAPABILITIES,
      ...(rates ? { costPer1kInput: rates.input, costPer1kOutput: rates.output } : {}),
      ...config.capabilities,
    }

    const provider = createGoogleGenerativeAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
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
