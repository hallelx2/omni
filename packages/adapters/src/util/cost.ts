import type { ModelCapabilities, ModelEvent } from "@omni/core"

/**
 * Pass-through stream transform that enriches `done` events with `costUsd`
 * computed from token usage and the adapter's capability rates. Yields
 * unchanged events otherwise. No-op when rates aren't configured.
 *
 * Cost = (promptTokens × costPer1kInput + completionTokens × costPer1kOutput) / 1000
 */
export async function* withCost(
  source: AsyncIterable<ModelEvent>,
  caps: ModelCapabilities,
): AsyncIterable<ModelEvent> {
  const hasRates = caps.costPer1kInput !== undefined && caps.costPer1kOutput !== undefined
  if (!hasRates) {
    yield* source
    return
  }
  for await (const ev of source) {
    if (ev.type === "done" && ev.usage) {
      const costUsd =
        (ev.usage.promptTokens * (caps.costPer1kInput ?? 0) +
          ev.usage.completionTokens * (caps.costPer1kOutput ?? 0)) /
        1000
      yield { ...ev, usage: { ...ev.usage, costUsd } }
    } else {
      yield ev
    }
  }
}
