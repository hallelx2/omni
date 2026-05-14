/**
 * `@omni/adapters` — model providers via Vercel AI SDK 6.
 *
 * - `OpenAICompatibleAdapter` covers MiMo, Ollama, OpenRouter, vLLM, LM Studio, etc.
 * - `AnthropicAdapter` and `OpenAIAdapter` for native provider features.
 * - `mimo()` and `ollama()` are factory helpers with sane per-provider defaults.
 * - `MockAdapter` is for tests; it does not hit any network.
 */

export { MockAdapter } from "./mock.ts"
export type { MockAdapterOptions, MockScript } from "./mock.ts"

export { OpenAICompatibleAdapter } from "./openai-compatible.ts"
export type { OpenAICompatibleAdapterConfig } from "./openai-compatible.ts"

export { mimo } from "./mimo.ts"
export type { MiMoAdapterConfig, MiMoModel } from "./mimo.ts"

export { ollama } from "./ollama.ts"
export type { OllamaAdapterConfig } from "./ollama.ts"

export { AnthropicAdapter } from "./anthropic.ts"
export type { AnthropicAdapterConfig, AnthropicModel } from "./anthropic.ts"

export { OpenAIAdapter } from "./openai.ts"
export type { OpenAIAdapterConfig, OpenAIModel } from "./openai.ts"

export { GoogleAdapter } from "./google.ts"
export type { GoogleAdapterConfig, GoogleModel } from "./google.ts"

// Low-level translation utilities for advanced consumers / custom adapters.
export { messagesToAISDK } from "./util/messages.ts"
export { toolsToAISDK } from "./util/tools.ts"
export { translateStream } from "./util/stream.ts"
export { withCost } from "./util/cost.ts"
