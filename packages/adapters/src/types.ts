import type { ModelAdapter, ModelCapabilities } from "@omni/core/types"

export interface AdapterFactory<TConfig> {
  create(config: TConfig): ModelAdapter
}

export interface OpenAICompatibleConfig {
  readonly apiKey: string
  readonly baseURL: string
  readonly model: string
  readonly id?: string
  readonly name?: string
  readonly capabilities?: Partial<ModelCapabilities>
}
