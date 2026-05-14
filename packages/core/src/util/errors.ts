export type ErrorCategory =
  | "network"
  | "rate_limit"
  | "auth"
  | "context_overflow"
  | "invalid_request"
  | "tool_failure"
  | "aborted"
  | "internal"
  | "unknown"

const CLASSIFIED_MARKER = Symbol.for("@omni/core/classified-error")

export interface ClassifiedError extends Error {
  readonly category: ErrorCategory
  readonly retryable: boolean
  readonly retryAfterMs?: number
  readonly cause?: unknown
  readonly httpStatus?: number
}

/**
 * Hints passed by adapters/tools so the classifier doesn't have to guess.
 * - `httpStatus`: HTTP response status (preferred over message parsing)
 * - `providerCode`: provider-specific error code (e.g. "rate_limit_exceeded")
 * - `retryAfterMs`: hint for backoff if the provider tells us
 */
export interface ClassifyHints {
  readonly httpStatus?: number
  readonly providerCode?: string
  readonly retryAfterMs?: number
}

/**
 * Coerce any thrown value into a ClassifiedError. Idempotent: passing an
 * already-classified error returns it unchanged. Adapters should pass hints
 * for accurate categorization; the heuristic fallbacks are best-effort.
 */
export function classifyError(input: unknown, hints: ClassifyHints = {}): ClassifiedError {
  if (isClassified(input)) return input

  const err = input instanceof Error ? input : new Error(String(input))
  const msg = err.message.toLowerCase()
  const status = hints.httpStatus ?? extractStatus(err)
  const code = hints.providerCode

  let category: ErrorCategory = "unknown"
  let retryable = false
  let retryAfterMs = hints.retryAfterMs

  if (err.name === "AbortError" || msg.includes("aborted") || msg === "the operation was aborted") {
    category = "aborted"
    retryable = false
  } else if (status === 401 || status === 403 || code === "invalid_api_key") {
    category = "auth"
    retryable = false
  } else if (status === 429 || code === "rate_limit_exceeded") {
    category = "rate_limit"
    retryable = true
    retryAfterMs ??= 2_000
  } else if (status === 400 && /context|token|maximum.*length/i.test(err.message)) {
    category = "context_overflow"
    retryable = false
  } else if (status === 400) {
    category = "invalid_request"
    retryable = false
  } else if (status && status >= 500 && status < 600) {
    category = "network"
    retryable = true
    retryAfterMs ??= 1_500
  } else if (
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("socket")
  ) {
    category = "network"
    retryable = true
    retryAfterMs ??= 1_000
  }

  const classified = Object.assign(err, {
    category,
    retryable,
    retryAfterMs,
    httpStatus: status,
    cause: err.cause ?? input,
    [CLASSIFIED_MARKER]: true,
  }) as ClassifiedError
  return classified
}

function isClassified(x: unknown): x is ClassifiedError {
  return (
    x instanceof Error &&
    (x as unknown as Record<symbol, unknown>)[CLASSIFIED_MARKER] === true
  )
}

function extractStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined
  const candidate = (err as { status?: unknown; statusCode?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode
  return typeof candidate === "number" ? candidate : undefined
}
