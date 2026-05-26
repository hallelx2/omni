import type { ModelCapabilities, ModelEvent } from "@omni/core"

/**
 * Pass-through stream transform that enriches `done` events with `costUsd`
 * computed from token usage and the adapter's capability rates. Yields
 * unchanged events otherwise. No-op when rates aren't configured.
 *
 * Cached input tokens (prompt-cache reads) are billed at `costPer1kCachedInput`
 * (default: 10% of `costPer1kInput`) — the rest of the prompt at full input rate:
 *
 *   Cost = ((promptTokens − cached) × costPer1kInput
 *           + cached × costPer1kCachedInput
 *           + completionTokens × costPer1kOutput) / 1000
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
  const inputRate = caps.costPer1kInput ?? 0
  const cachedRate = caps.costPer1kCachedInput ?? inputRate * 0.1
  for await (const ev of source) {
    if (ev.type === "done" && ev.usage) {
      const cached = ev.usage.cachedInputTokens ?? 0
      const uncachedInput = Math.max(0, ev.usage.promptTokens - cached)
      const costUsd =
        (uncachedInput * inputRate +
          cached * cachedRate +
          ev.usage.completionTokens * (caps.costPer1kOutput ?? 0)) /
        1000
      yield { ...ev, usage: { ...ev.usage, costUsd } }
    } else {
      yield ev
    }
  }
}
