import { describe, expect, test } from "bun:test"
import {
  MockAdapter,
  OpenAICompatibleAdapter,
  AnthropicAdapter,
  OpenAIAdapter,
  GoogleAdapter,
} from "../src/index.ts"

describe("ModelAdapter.languageModel()", () => {
  test("real adapters expose an AI SDK model (enables structured output)", () => {
    expect(new OpenAICompatibleAdapter({ baseURL: "https://example.com/v1", model: "m" }).languageModel()).toBeDefined()
    expect(new AnthropicAdapter({ apiKey: "test", model: "claude-haiku-4-5" }).languageModel()).toBeDefined()
    expect(new OpenAIAdapter({ apiKey: "test", model: "gpt-4o-mini" }).languageModel()).toBeDefined()
    expect(new GoogleAdapter({ apiKey: "test", model: "gemini-2.0-flash" }).languageModel()).toBeDefined()
  })

  test("mock adapter exposes no languageModel (stays on the text-parsing path)", () => {
    expect(new MockAdapter({ script: [] }).languageModel).toBeUndefined()
  })
})
