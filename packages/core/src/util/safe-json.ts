/**
 * JSON.stringify that never throws on cyclic structures or non-serialisable
 * values. Used for tracing/persisting EngineEvents, which can carry
 * classified errors whose `.cause` holds the original Error (Node system
 * errors, fetch errors, AbortError, etc.) — those frequently contain
 * circular references and would otherwise crash the tracer.
 *
 * Behaviour:
 *   - circular references → "[Circular]"
 *   - Error instances → { name, message, stack? } (stack capped)
 *   - bigint → string
 *   - functions / symbols / undefined → dropped (standard JSON behaviour)
 */
export function safeStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(
    value,
    function (_key, val) {
      if (val instanceof Error) {
        return {
          name: val.name,
          message: val.message,
          ...(val.stack ? { stack: val.stack.slice(0, 2000) } : {}),
        }
      }
      if (typeof val === "bigint") return val.toString()
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]"
        seen.add(val)
      }
      return val
    },
    space,
  )
}
