import { resolve, dirname } from "node:path"
import { mkdir, appendFile } from "node:fs/promises"
import type { EngineEvent } from "@omni/core"

/**
 * One line per event in JSONL. A trace file represents one session run.
 * Easy to grep, easy to feed back into evolution.
 */
export interface TraceLine {
  readonly t: number // unix millis
  readonly e: EngineEvent
}

/**
 * Persists engine events to a JSONL file. Plug into `EngineConfig.tracer`.
 * Designed for very low overhead: each event is one fs.append (Bun's
 * append is buffered). Closes itself on `engine.done`.
 *
 * @example
 * ```ts
 * const tr = new FileTracer({ path: ".omni/traces/2026-05-14-1234.jsonl" })
 * new Engine({ ..., tracer: (e) => tr.record(e) })
 * ```
 */
export class FileTracer {
  private _initialized = false
  private _pending: Promise<unknown> = Promise.resolve()

  constructor(private readonly opts: { readonly path: string }) {}

  async ensureDir(): Promise<void> {
    if (this._initialized) return
    await mkdir(dirname(resolve(this.opts.path)), { recursive: true })
    this._initialized = true
  }

  /**
   * Append one event. Returns immediately; the actual disk write happens in
   * the background. Use {@link flush} to await all pending writes.
   */
  record(event: EngineEvent): void {
    const line = JSON.stringify({ t: Date.now(), e: event } satisfies TraceLine) + "\n"
    this._pending = this._pending
      .then(() => this.ensureDir())
      .then(() => appendFile(this.opts.path, line))
      .catch(() => {})
  }

  /** Await all pending writes. Useful at session end and in tests. */
  async flush(): Promise<void> {
    await this._pending
  }
}

/**
 * Score a completed trace. Used by {@link evolve} to rank prompt variants.
 * Pure function over a list of events — given the same trace, returns the
 * same score.
 *
 * Heuristics (range [0, 1]):
 *   + done.reason === "model_done"          : +0.5
 *   + no engine.error events                : +0.2
 *   + no engine.loop_detected               : +0.1
 *   - per fatal_error                       : -1.0 (capped at 0)
 *   + tool calls were diverse (>1 unique)   : +0.1
 *   + completed in ≤ 8 iterations           : +0.1
 */
export function scoreTrace(events: readonly EngineEvent[]): number {
  let score = 0
  let done: Extract<EngineEvent, { type: "engine.done" }> | undefined
  let errors = 0
  let loopDetected = 0
  let iterations = 0
  const toolNames = new Set<string>()
  for (const e of events) {
    if (e.type === "engine.done") done = e
    else if (e.type === "engine.error" && e.fatal) errors++
    else if (e.type === "engine.loop_detected") loopDetected++
    else if (e.type === "engine.iteration") iterations = e.iteration
    else if (e.type === "tool.start") toolNames.add(e.call.name)
  }
  if (done?.reason === "model_done") score += 0.5
  if (errors === 0) score += 0.2
  else score -= errors * 1.0
  if (loopDetected === 0) score += 0.1
  if (toolNames.size > 1) score += 0.1
  if (iterations > 0 && iterations <= 8) score += 0.1
  return Math.max(0, Math.min(1, score))
}

/** Parse a JSONL trace file back into events. */
export async function readTrace(path: string): Promise<readonly EngineEvent[]> {
  const text = await Bun.file(path).text()
  const events: EngineEvent[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    try {
      const parsed = JSON.parse(line) as TraceLine
      events.push(parsed.e)
    } catch {
      // skip malformed line
    }
  }
  return events
}
