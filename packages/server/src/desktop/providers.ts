/**
 * Static registry of model providers + their known models, enriched at
 * request time with whether a credential is currently resolvable. Drives the
 * settings UI's provider/model pickers.
 */
import { resolveApiKey, type Config } from "@omni/core"
import type { ProviderInfo } from "./protocol.ts"

interface ProviderDef {
  readonly id: string
  readonly label: string
  readonly models: readonly string[]
  readonly needsKey: boolean
  readonly supportsBaseURL: boolean
  readonly keyEnv?: string
  readonly resolveProvider?: "mimo" | "anthropic" | "openai" | "google"
}

const PROVIDERS: readonly ProviderDef[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    models: [
      "claude-opus-4-7",
      "claude-opus-4-5",
      "claude-sonnet-4-6",
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
    ],
    needsKey: true,
    supportsBaseURL: true,
    keyEnv: "ANTHROPIC_API_KEY",
    resolveProvider: "anthropic",
  },
  {
    id: "openai",
    label: "OpenAI",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o1-mini"],
    needsKey: true,
    supportsBaseURL: true,
    keyEnv: "OPENAI_API_KEY",
    resolveProvider: "openai",
  },
  {
    id: "google",
    label: "Google",
    models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
    needsKey: true,
    supportsBaseURL: false,
    keyEnv: "GOOGLE_API_KEY",
    resolveProvider: "google",
  },
  {
    id: "mimo",
    label: "MiMo",
    models: ["mimo-v2.5-pro", "mimo-v2.5"],
    needsKey: true,
    supportsBaseURL: true,
    keyEnv: "MIMO_API_KEY",
    resolveProvider: "mimo",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    models: ["qwen2.5-coder:7b", "llama3.1", "deepseek-r1:7b"],
    needsKey: false,
    supportsBaseURL: true,
  },
  {
    id: "mock",
    label: "Mock (offline)",
    models: ["mock"],
    needsKey: false,
    supportsBaseURL: false,
  },
]

export function providerRegistry(config: Config): ProviderInfo[] {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    models: p.models,
    needsKey: p.needsKey,
    supportsBaseURL: p.supportsBaseURL,
    keyEnv: p.keyEnv,
    hasKey: !p.needsKey || (p.resolveProvider ? !!resolveApiKey(p.resolveProvider, config) : false),
  }))
}

/** Default "provider:model" given the current config, mirroring CLI pickAdapter. */
export function defaultModelRef(config: Config): string {
  const adapter = config.adapter ?? (resolveApiKey("mimo", config) ? "mimo" : "mock")
  const def = PROVIDERS.find((p) => p.id === adapter)
  const model = config.model ?? def?.models[0] ?? "mock"
  return `${adapter}:${model}`
}

export function knownProviderIds(): readonly string[] {
  return PROVIDERS.map((p) => p.id)
}
