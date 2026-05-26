import type { CumulativeUsage, UsageDelta } from "../types.ts"

/** @internal */
export function zeroUsage(): CumulativeUsage {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    callCount: 0,
  }
}

/** @internal */
export function accumulateUsage(prev: CumulativeUsage, delta: UsageDelta): CumulativeUsage {
  return {
    promptTokens: prev.promptTokens + delta.promptTokens,
    completionTokens: prev.completionTokens + delta.completionTokens,
    totalTokens: prev.totalTokens + delta.totalTokens,
    cachedInputTokens: (prev.cachedInputTokens ?? 0) + (delta.cachedInputTokens ?? 0),
    callCount: prev.callCount + 1,
    costUsd: (prev.costUsd ?? 0) + (delta.costUsd ?? 0) || prev.costUsd,
  }
}
