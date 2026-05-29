import { resolve, dirname } from "node:path"
import { mkdir, appendFile } from "node:fs/promises"
import { safeStringify, type EngineEvent } from "@omni/core"

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
    const line = safeStringify({ t: Date.now(), e: event } satisfies TraceLine) + "\n"
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
 * Score a completed trace in `[0, 1]`. Used by the evolution loop to rank
 * prompt variants. Pure function over a list of events — same trace, same
 * score.
 *
 * **Verifier outcomes are the PRIMARY success signal.** The CRITIC pattern
 * grounds correctness in external checks (`verifier.result` with status
 * pass/fail; "skip" is ignored). Process proxies (clean finish, no loops, tool
 * diversity, iteration economy) are a secondary tie-breaker that dominates only
 * when no verifier graded the session (e.g. a pure-research run with no edits).
 *
 *   verifierScore = passes / (passes + fails)            // "skip" excluded
 *   processScore  = weighted proxies, in [0, 1] (see below)
 *   w             = min(0.85, 0.5 + 0.1 * graded)         // more evidence → trust verifiers more
 *   score         = graded === 0 ? processScore : w·verifierScore + (1-w)·processScore
 *   fatal error caps the score at 0.10 (a crashed run is never a success).
 */
export function scoreTrace(events: readonly EngineEvent[]): number {
  let done: Extract<EngineEvent, { type: "engine.done" }> | undefined
  let fatalErrors = 0
  let loopDetected = 0
  let iterations = 0
  let passes = 0
  let fails = 0
  const toolNames = new Set<string>()
  for (const e of events) {
    if (e.type === "engine.done") done = e
    else if (e.type === "engine.error" && e.fatal) fatalErrors++
    else if (e.type === "engine.loop_detected") loopDetected++
    else if (e.type === "engine.iteration") iterations = e.iteration
    else if (e.type === "tool.start") toolNames.add(e.call.name)
    else if (e.type === "verifier.result") {
      if (e.status === "pass") passes++
      else if (e.status === "fail") fails++
    }
  }

  const processScore =
    0.55 * (done?.reason === "model_done" ? 1 : 0) +
    0.2 * (fatalErrors === 0 ? 1 : 0) +
    0.1 * (loopDetected === 0 ? 1 : 0) +
    0.1 * (toolNames.size > 1 ? 1 : 0) +
    0.05 * (iterations > 0 && iterations <= 8 ? 1 : 0)

  const graded = passes + fails
  let score: number
  if (graded === 0) {
    score = processScore
  } else {
    const verifierScore = passes / graded
    const w = Math.min(0.85, 0.5 + 0.1 * graded)
    score = w * verifierScore + (1 - w) * processScore
  }
  if (fatalErrors > 0) score = Math.min(score, 0.1)
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
