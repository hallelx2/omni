import type { EngineEvent } from "@omni/core"
import { readTrace } from "./traces.ts"

/**
 * Replay a recorded trace as an AsyncIterable<EngineEvent>. Yields events in
 * order, optionally pacing playback by `delayMs` between events (helpful for
 * UI demos).
 *
 * Use cases:
 *   - Regression: load a real session trace and verify it still matches an
 *     expected outcome.
 *   - UI testing: feed canned events into a renderer without spawning an
 *     engine + model.
 */
export async function* replayTrace(
  path: string,
  options: { readonly delayMs?: number } = {},
): AsyncIterable<EngineEvent> {
  const events = await readTrace(path)
  for (const e of events) {
    if (options.delayMs) await Bun.sleep(options.delayMs)
    yield e
  }
}

/**
 * Replay a trace and assert event sequence properties. Returns a list of
 * violations (empty when the trace satisfies all checks).
 */
export interface ReplayChecks {
  readonly mustContainTypes?: readonly string[]
  readonly mustEndWith?: string
  readonly maxIterations?: number
  readonly maxErrors?: number
}

export async function checkTrace(
  path: string,
  checks: ReplayChecks,
): Promise<readonly string[]> {
  const events = await readTrace(path)
  const violations: string[] = []
  const types = new Set(events.map((e) => e.type))
  for (const t of checks.mustContainTypes ?? []) {
    if (!types.has(t as EngineEvent["type"])) {
      violations.push(`missing event type: ${t}`)
    }
  }
  if (checks.mustEndWith) {
    const last = events[events.length - 1]
    if (last?.type !== checks.mustEndWith) {
      violations.push(`expected last event ${checks.mustEndWith}, got ${last?.type ?? "(none)"}`)
    }
  }
  if (checks.maxIterations !== undefined) {
    const iters = events.filter((e) => e.type === "engine.iteration").length
    if (iters > checks.maxIterations) {
      violations.push(`too many iterations: ${iters} > ${checks.maxIterations}`)
    }
  }
  if (checks.maxErrors !== undefined) {
    const errs = events.filter((e) => e.type === "engine.error").length
    if (errs > checks.maxErrors) {
      violations.push(`too many errors: ${errs} > ${checks.maxErrors}`)
    }
  }
  return violations
}
