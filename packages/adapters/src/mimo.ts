import {
  OpenAICompatibleAdapter,
  type OpenAICompatibleAdapterConfig,
} from "./openai-compatible.ts"
import type { ModelCapabilities } from "@omni/core"

export type MiMoModel =
  | "mimo-v2.5-pro"
  | "mimo-v2.5"
  | "mimo-v2-flash"
  | "mimo-v2-pro"
  | (string & {})

export interface MiMoAdapterConfig {
  readonly apiKey: string
  readonly model?: MiMoModel
  /** Override the endpoint (e.g. CN region or self-hosted gateway). */
  readonly baseURL?: string
  readonly capabilities?: Partial<ModelCapabilities>
  readonly fetch?: typeof fetch
}

const MIMO_DEFAULT_BASE = "https://api.xiaomimimo.com/v1"

/**
 * Per-model capability snapshots. Rates are illustrative; override via
 * `capabilities` for billing accuracy.
 */
const MIMO_CAPABILITIES: Record<string, Partial<ModelCapabilities>> = {
  "mimo-v2.5-pro": {
    contextWindow: 128_000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsParallelToolCalls: true,
    supportsThinking: true,
    costPer1kInput: 0.0005,
    costPer1kOutput: 0.0015,
  },
  "mimo-v2.5": {
    contextWindow: 128_000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsParallelToolCalls: true,
    costPer1kInput: 0.0003,
    costPer1kOutput: 0.001,
  },
  "mimo-v2-flash": {
    contextWindow: 64_000,
    supportsToolCalls: true,
    supportsStreaming: true,
    supportsParallelToolCalls: true,
    costPer1kInput: 0.0001,
    costPer1kOutput: 0.0004,
  },
}

/**
 * Xiaomi MiMo adapter. Targets the platform.xiaomimimo.com OpenAI-compatible
 * endpoint. Picks reasonable per-model capabilities so the engine's context
 * manager can budget correctly.
 *
 * @example
 * ```ts
 * import { mimo } from "@omni/adapters"
 * const adapter = mimo({ apiKey: process.env.MIMO_API_KEY!, model: "mimo-v2.5-pro" })
 * ```
 */
export function mimo(config: MiMoAdapterConfig): OpenAICompatibleAdapter {
  const model = config.model ?? "mimo-v2.5-pro"
  const known = MIMO_CAPABILITIES[model]
  const opts: OpenAICompatibleAdapterConfig = {
    providerName: "mimo",
    baseURL: config.baseURL ?? MIMO_DEFAULT_BASE,
    apiKey: config.apiKey,
    model,
    name: model,
    capabilities: { ...(known ?? {}), ...config.capabilities },
    fetch: config.fetch,
  }
  return new OpenAICompatibleAdapter(opts)
}
