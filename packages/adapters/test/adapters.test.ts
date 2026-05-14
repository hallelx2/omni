import { describe, expect, test } from "bun:test"
import {
  AnthropicAdapter,
  GoogleAdapter,
  MockAdapter,
  OpenAIAdapter,
  OpenAICompatibleAdapter,
  mimo,
  ollama,
} from "../src/index.ts"

describe("Adapter construction", () => {
  test("MockAdapter", () => {
    const a = new MockAdapter({ script: [{ kind: "text", text: "ok" }] })
    expect(a.id).toBe("mock-1")
    expect(a.name).toBe("mock")
    expect(a.capabilities.supportsToolCalls).toBe(true)
  })

  test("OpenAICompatibleAdapter", () => {
    const a = new OpenAICompatibleAdapter({
      baseURL: "http://localhost:8080/v1",
      apiKey: "test",
      model: "test-model",
    })
    expect(a.id).toBe("openai-compatible:test-model")
    expect(a.name).toBe("test-model")
    expect(a.capabilities.contextWindow).toBeGreaterThan(0)
  })

  test("mimo() factory uses xiaomimimo endpoint and per-model caps", () => {
    const a = mimo({ apiKey: "x", model: "mimo-v2.5-pro" })
    expect(a.id).toBe("mimo:mimo-v2.5-pro")
    expect(a.capabilities.contextWindow).toBe(128_000)
    expect(a.capabilities.supportsThinking).toBe(true)
  })

  test("mimo() supports unknown model with defaults", () => {
    const a = mimo({ apiKey: "x", model: "mimo-future" })
    expect(a.capabilities.supportsToolCalls).toBe(true)
  })

  test("mimo() honors baseURL override", () => {
    const a = mimo({ apiKey: "x", baseURL: "https://example.com/v1" })
    expect(a.id).toContain("mimo:")
  })

  test("ollama() defaults to localhost endpoint", () => {
    const a = ollama({ model: "qwen2.5-coder:7b" })
    expect(a.id).toBe("ollama:qwen2.5-coder:7b")
    expect(a.capabilities.supportsStreaming).toBe(true)
  })

  test("AnthropicAdapter", () => {
    const a = new AnthropicAdapter({ apiKey: "x", model: "claude-sonnet-4-5" })
    expect(a.id).toBe("anthropic:claude-sonnet-4-5")
    expect(a.capabilities.contextWindow).toBe(200_000)
    expect(a.capabilities.supportsThinking).toBe(true)
  })

  test("OpenAIAdapter", () => {
    const a = new OpenAIAdapter({ apiKey: "x", model: "gpt-4o" })
    expect(a.id).toBe("openai:gpt-4o")
    expect(a.capabilities.supportsParallelToolCalls).toBe(true)
    expect(a.capabilities.costPer1kInput).toBe(0.0025)
    expect(a.capabilities.costPer1kOutput).toBe(0.01)
  })

  test("GoogleAdapter", () => {
    const a = new GoogleAdapter({ apiKey: "x", model: "gemini-2.0-flash" })
    expect(a.id).toBe("google:gemini-2.0-flash")
    expect(a.capabilities.contextWindow).toBe(1_000_000)
  })

  test("MiMo populates cost rates per model", () => {
    const a = mimo({ apiKey: "x", model: "mimo-v2.5-pro" })
    expect(a.capabilities.costPer1kInput).toBeGreaterThan(0)
    expect(a.capabilities.costPer1kOutput).toBeGreaterThan(0)
  })

  test("Anthropic populates cost rates per model", () => {
    const a = new AnthropicAdapter({ apiKey: "x", model: "claude-sonnet-4-5" })
    expect(a.capabilities.costPer1kInput).toBe(0.003)
    expect(a.capabilities.costPer1kOutput).toBe(0.015)
  })

  test("AnthropicAdapter accepts thinking config", () => {
    const a = new AnthropicAdapter({
      apiKey: "x",
      model: "claude-opus-4-7",
      thinking: { enabled: true, budgetTokens: 2048 },
    })
    expect(a.id).toBe("anthropic:claude-opus-4-7")
  })

  test("capabilities override merges correctly", () => {
    const a = mimo({
      apiKey: "x",
      model: "mimo-v2.5-pro",
      capabilities: { contextWindow: 64_000 },
    })
    expect(a.capabilities.contextWindow).toBe(64_000)
    expect(a.capabilities.supportsThinking).toBe(true) // preserved from defaults
  })
})
