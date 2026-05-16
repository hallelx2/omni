import type { ToolCall } from "./types.ts"

/**
 * A Verifier inspects a tool's result through an *external* check (test
 * runner, type-checker, linter, parse-attempt, …) rather than asking the
 * model to grade itself. This is the CRITIC pattern (Gou et al. 2023): pair
 * every actor with a tool-grounded judge.
 *
 * The engine runs all applicable verifiers after a tool completes. A
 * verifier that returns `fail` causes the engine to inject correction
 * feedback into history so the model can self-correct on the next
 * iteration — but it does NOT abort the run on its own.
 *
 * Verifiers are construction-time configuration on the engine, like tools
 * and hooks. They cannot mutate state — `verify()` is read-only against
 * the workspace except for spawning the verification subprocess itself.
 */
export interface Verifier {
  /** Stable identifier surfaced in events and stored stats. */
  readonly name: string

  /**
   * Tool names this verifier should run after. When undefined, the verifier
   * runs after every tool. Use specific names (e.g. ["edit", "apply_patch"])
   * to scope expensive verifiers to relevant changes.
   */
  readonly appliesTo?: readonly string[]

  /**
   * Hint to the engine for scheduling. "cheap" verifiers always run;
   * "expensive" ones can be skipped under load or in fast paths. Default
   * "cheap".
   */
  readonly cost?: "cheap" | "expensive"

  /**
   * Perform the check. Implementations MUST honor `ctx.signal` for
   * cancellation and SHOULD report progress via `ctx.onProgress` for
   * long-running checks (test suites, type-checks).
   */
  verify(ctx: VerifyContext): Promise<VerifierResult>
}

/** Execution environment given to a verifier. */
export interface VerifyContext {
  /** The tool call whose result we are verifying. */
  readonly call: ToolCall
  /** The final tool result (post-postToolUse hooks). */
  readonly result: unknown
  /** Workspace working directory. */
  readonly cwd: string
  /** Aborts when the engine's run aborts. */
  readonly signal: AbortSignal
  /** Optional environment vars (e.g. CI=1 to suppress test watchers). */
  readonly env?: Readonly<Record<string, string>>
  /** Emit a progress line that the engine surfaces as `verifier.progress`. */
  readonly onProgress?: (message: string) => void
}

/** Outcome of a single verifier run. */
export interface VerifierResult {
  /** Echo of the verifier name for routing. */
  readonly verifier: string
  /**
   * - "pass"  — check succeeded. The model's tool call is fine.
   * - "fail"  — check failed. Feedback will be injected into history.
   * - "skip"  — verifier didn't apply (e.g. no test config, wrong file type).
   *             Skips never block; they just don't contribute a signal.
   */
  readonly status: "pass" | "fail" | "skip"
  /**
   * One-line human-readable summary. REQUIRED on fail and skip; optional on
   * pass (where the engine usually doesn't surface it).
   */
  readonly reason?: string
  /**
   * Detailed feedback shown to the model on `fail`. Should be terse and
   * actionable — test names that failed, type-error messages with file:line,
   * lint rule names. The engine truncates excessive output.
   */
  readonly feedback?: string
  /**
   * Structured details for tracers and stats. Free-form per verifier.
   * Example: { failingTests: ["test/foo.test.ts:bar"] }.
   */
  readonly details?: Readonly<Record<string, unknown>>
  /** Wall time for the check itself, in ms. Filled in by the engine if absent. */
  readonly durationMs?: number
}

/**
 * Decide which verifiers should run for a given tool call.
 *
 * Rules:
 *   - A verifier with no `appliesTo` runs for every tool.
 *   - A verifier with `appliesTo: ["edit"]` runs only when call.name === "edit".
 *   - The list preserves verifier-registration order.
 */
export function selectApplicableVerifiers(
  verifiers: readonly Verifier[],
  toolName: string,
): readonly Verifier[] {
  return verifiers.filter(
    (v) => v.appliesTo === undefined || v.appliesTo.includes(toolName),
  )
}

/**
 * Truncate verifier feedback so a chatty linter doesn't blow the context
 * window. Keeps the first `headBytes` and the last `tailBytes` with an
 * elision marker.
 */
export function truncateFeedback(
  text: string,
  maxBytes = 4_000,
): string {
  if (text.length <= maxBytes) return text
  const head = Math.floor(maxBytes * 0.7)
  const tail = Math.floor(maxBytes * 0.2)
  const dropped = text.length - head - tail
  return (
    text.slice(0, head) +
    `\n\n[... ${dropped} bytes elided ...]\n\n` +
    text.slice(-tail)
  )
}
