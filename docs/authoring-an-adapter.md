# Authoring a model adapter

An adapter plugs a model provider into the engine. It translates Omni's
normalized message and tool shapes into the provider's API and translates
the provider's stream back into `ModelEvent`s.

## When to write one

You probably don't need to. `OpenAICompatibleAdapter` covers any provider
that speaks the OpenAI Chat Completions protocol — that's MiMo, Ollama,
OpenRouter, vLLM, LM Studio, Together, DeepInfra, Fireworks, and most
self-hosted options.

Write a dedicated adapter when:
- The provider has features not expressed in the OpenAI protocol (Anthropic
  thinking blocks, OpenAI Responses API, Google's grounding tools).
- You need provider-specific request shaping (custom headers, signed URLs,
  multi-step auth).
- You're integrating a non-OpenAI-compatible provider from scratch.

## Minimum example

```ts
import { streamText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import type { CompleteParams, ModelAdapter, ModelCapabilities, ModelEvent } from "@omni/core"
import { messagesToAISDK, toolsToAISDK, translateStream, withCost } from "@omni/adapters"

export class MyAdapter implements ModelAdapter {
  readonly id: string
  readonly name: string
  readonly capabilities: ModelCapabilities
  private readonly _model: ReturnType<ReturnType<typeof createOpenAI>>

  constructor(config: { apiKey: string; model: string }) {
    this.id = `myprovider:${config.model}`
    this.name = config.model
    this.capabilities = {
      contextWindow: 128_000,
      supportsToolCalls: true,
      supportsStreaming: true,
    }
    this._model = createOpenAI({ apiKey: config.apiKey })(config.model)
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
```

## The contract

```ts
interface ModelAdapter {
  readonly id: string                           // stable identifier
  readonly name: string                         // human-readable
  readonly capabilities: ModelCapabilities
  complete(params: CompleteParams): AsyncIterable<ModelEvent>
}
```

### `id` and `name`
`id` should be unique within a session (used in events). Convention:
`"<provider>:<model>"`. `name` is for UIs.

### `capabilities`

```ts
interface ModelCapabilities {
  readonly contextWindow: number
  readonly maxOutputTokens?: number
  readonly supportsToolCalls: boolean
  readonly supportsStreaming: boolean
  readonly supportsParallelToolCalls?: boolean
  readonly supportsThinking?: boolean
  readonly costPer1kInput?: number
  readonly costPer1kOutput?: number
}
```

The engine reads `contextWindow` and `maxOutputTokens` for context budgeting,
and `withCost` reads the rates to populate `UsageDelta.costUsd`. The
`improve/probe` and `improve/adapt` subsystems read the rest.

### `complete(params)`

Receives:

```ts
interface CompleteParams {
  readonly messages: readonly Message[]       // omni-shaped
  readonly tools: readonly ToolSchema[]       // JSON Schema params
  readonly temperature?: number
  readonly maxTokens?: number
  readonly signal: AbortSignal                // MUST honor
}
```

Must yield `ModelEvent` per the discriminated union:

- `delta { text }` — streaming assistant text chunk
- `thinking_delta { text }` — streaming reasoning (when applicable)
- `tool_call_start { call }` — model started composing a tool call
- `tool_call_args_delta { callId, argsDelta }` — partial JSON args streaming
- `tool_call { call }` — completed tool call (must appear exactly once per call)
- `done { finishReason, usage? }` — terminal event
- `error { error }` — terminal error event

The engine handles validation, permissions, execution, and feeding results
back. The adapter only translates.

## Using the AI SDK translation utilities

Three utilities ship with `@omni/adapters`:

- **`messagesToAISDK(messages)`** — Omni `Message[]` → AI SDK `ModelMessage[]`.
  Handles role mapping, tool_calls expansion to content parts, and
  provider-specific `reasoning_content` round-tripping via `providerOptions`.

- **`toolsToAISDK(tools)`** — Omni `ToolSchema[]` → AI SDK tool record. Does
  NOT attach an `execute` function (the engine owns execution; we only need
  the provider to forward tool calls back).

- **`translateStream(fullStream)`** — AI SDK `TextStreamPart` stream →
  Omni `ModelEvent` stream. Handles all 7 emitted event kinds and silently
  ignores the rest.

- **`withCost(stream, caps)`** — pass-through that enriches `done` events
  with `usage.costUsd` from the rates declared in `capabilities`.

Chain them as in the minimum example above.

## Provider-specific gotchas

### Thinking-mode roundtripping (MiMo, DeepSeek, Anthropic)

Some providers' thinking-mode emits a `reasoning_content` field that must be
echoed back on subsequent requests. The engine captures `thinking_delta`
text into `Message.metadata.reasoningContent`. `messagesToAISDK` already
translates this into both `providerOptions.openaiCompatible.reasoning_content`
(for OpenAI-compatible) and `providerOptions.anthropic.thinking` (for native
Claude). If your provider uses a different field, intercept in the adapter
and override `providerOptions`.

### Custom auth headers

Pass `headers` through the SDK provider factory:

```ts
createOpenAICompatible({
  baseURL: "...",
  apiKey: "...",
  headers: { "X-Org-Id": "..." },
})
```

### URL routing differences

The AI SDK's Anthropic provider appends `/messages` to your `baseURL`, not
`/v1/messages`. If targeting a self-hosted Anthropic-compatible endpoint
(like MiMo's anthropic-compatible URL), include `/v1` in the base:
`https://example.com/anthropic/v1`.

### JSON Schema dialect

Tools are sent as JSON Schema. The engine uses `zod-to-json-schema` with
`target: "jsonSchema7"` (draft-07 numeric form of `exclusiveMinimum` etc.).
Some servers reject draft-04 boolean forms — if your provider does, the
default config already produces the right shape. Don't override unless you
know your server prefers the older form.

## Testing your adapter

The AI SDK's `simulateReadableStream` and custom `LanguageModelV3` can drive
deterministic tests. The easier approach: inject a fake `fetch` (Bun's
`Bun.serve` makes spinning up a local SSE endpoint trivial) and verify the
full pipeline works against canned bytes.

See `packages/adapters/test/openai-compatible.e2e.test.ts` for an example
that exercises text streaming, tool-call streaming, and mid-stream abort
against a fake fetch.

## Preset factories

If your adapter has per-model defaults (capabilities, base URL), expose a
factory:

```ts
export function myProvider(config: MyProviderConfig): MyAdapter {
  return new MyAdapter({ ...DEFAULTS_FOR[config.model], ...config })
}
```

Then users get sensible behavior out of the box:

```ts
import { myProvider } from "@omni/adapters"
const adapter = myProvider({ apiKey: "...", model: "fast" })
```
