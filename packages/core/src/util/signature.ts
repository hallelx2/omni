import type { ToolCall } from "../types.ts"

/**
 * Deterministic signature of a set of tool calls. Used for loop detection:
 * if the same signature recurs N times in a row, the model is spinning.
 *
 * @internal
 */
export function toolCallSetSignature(calls: readonly ToolCall[]): string {
  if (calls.length === 0) return ""
  const parts = calls.map((c) => `${c.name}:${stableStringify(c.args)}`)
  parts.sort()
  return parts.join("|")
}

/** @internal */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`
}
