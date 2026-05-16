import type { Verifier, VerifyContext, VerifierResult } from "@omni/core"
import { runShellVerifier } from "./typecheck.ts"

export interface TestVerifierOptions {
  /**
   * Command to run. Default `bun test`. Override with your project's runner
   * (e.g. `npm test`, `pnpm test`, `pytest -q`, `cargo test`).
   */
  readonly command?: string
  /**
   * Working directory. Defaults to verify ctx's cwd.
   */
  readonly cwd?: string
  /**
   * Max wall time. Default 120s. Test suites longer than this should NOT
   * run per-turn — break them into smaller verifiers, run them offline,
   * or scope this verifier to specific tool changes.
   */
  readonly timeoutMs?: number
  /**
   * Tools after which tests run. Default: edit, write, multi_edit,
   * apply_patch. Add "bash" if you want tests to run after shell actions
   * (rare and usually noisy).
   */
  readonly appliesTo?: readonly string[]
}

/**
 * Run the project's test suite after file changes. Opt-in because (a)
 * tests can be slow and (b) the command is project-specific.
 *
 * On fail, the entire test runner output is fed back to the model. Bun
 * Test, Vitest, Pytest, and Cargo all emit test names + assertion
 * diffs at non-zero exit, which is the signal we want.
 */
export class TestVerifier implements Verifier {
  readonly name = "tests"
  readonly cost = "expensive" as const
  readonly appliesTo: readonly string[]

  private readonly command: string
  private readonly cwd?: string
  private readonly timeoutMs: number

  constructor(opts: TestVerifierOptions = {}) {
    this.command = opts.command ?? "bun test"
    this.cwd = opts.cwd
    this.timeoutMs = opts.timeoutMs ?? 120_000
    this.appliesTo = opts.appliesTo ?? ["edit", "write", "multi_edit", "apply_patch"]
  }

  async verify(ctx: VerifyContext): Promise<VerifierResult> {
    return runShellVerifier({
      name: this.name,
      command: this.command,
      cwd: this.cwd ?? ctx.cwd,
      env: { CI: "1", ...(ctx.env ?? {}) },
      signal: ctx.signal,
      timeoutMs: this.timeoutMs,
      onProgress: ctx.onProgress,
      passReason: "test suite passed",
      failReason: "test suite reported failures",
      failGuidance:
        "Read the failing test output above. Each failure names the test and what it expected vs got. Fix the production code to make the test pass — do NOT delete or weaken the test.",
    })
  }
}
