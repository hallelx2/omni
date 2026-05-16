import type { Verifier, VerifyContext, VerifierResult } from "@omni/core"

export interface TypecheckVerifierOptions {
  /**
   * Command to run. Defaults to `bunx tsc --noEmit`. If your project uses a
   * different type-checker (vue-tsc, deno check, mypy), override here.
   */
  readonly command?: string
  /**
   * Working directory for the command. Defaults to the verify ctx's cwd.
   * Useful when the typecheck must run from a monorepo subpackage.
   */
  readonly cwd?: string
  /**
   * Max wall time. Default 60s. Long-running type-checks usually mean a
   * project too large for per-turn verification — scope the verifier
   * differently if this fires.
   */
  readonly timeoutMs?: number
  /**
   * Tool names this verifier should run after. Defaults to file-mutating
   * tools (edit, write, multi_edit, apply_patch).
   */
  readonly appliesTo?: readonly string[]
}

/**
 * Run a type-checker after file changes. Opt-in because:
 *   1. Even an incremental tsc takes a few seconds on a real project.
 *   2. Most projects have a custom incantation (project flag, vue-tsc, etc.)
 *      we can't infer reliably.
 *
 * The verifier shells out, captures stdout+stderr, and considers exit code
 * 0 a pass. Non-zero exit becomes feedback containing the (truncated)
 * output so the model can see specific TS2304/TS2322/... errors.
 */
export class TypecheckVerifier implements Verifier {
  readonly name = "typecheck"
  readonly cost = "expensive" as const
  readonly appliesTo: readonly string[]

  private readonly command: string
  private readonly cwd?: string
  private readonly timeoutMs: number

  constructor(opts: TypecheckVerifierOptions = {}) {
    this.command = opts.command ?? "bunx tsc --noEmit"
    this.cwd = opts.cwd
    this.timeoutMs = opts.timeoutMs ?? 60_000
    this.appliesTo = opts.appliesTo ?? ["edit", "write", "multi_edit", "apply_patch"]
  }

  async verify(ctx: VerifyContext): Promise<VerifierResult> {
    return runShellVerifier({
      name: this.name,
      command: this.command,
      cwd: this.cwd ?? ctx.cwd,
      env: ctx.env,
      signal: ctx.signal,
      timeoutMs: this.timeoutMs,
      onProgress: ctx.onProgress,
      passReason: "typecheck clean",
      failReason: "typecheck reported errors",
      failGuidance:
        "Read each TS error message above. Fix the type errors at the file:line locations cited.",
    })
  }
}

/**
 * Internal helper: run a shell command and translate exit code into a
 * VerifierResult. Used by TypecheckVerifier, LintVerifier, TestVerifier.
 */
export async function runShellVerifier(opts: {
  readonly name: string
  readonly command: string
  readonly cwd: string
  readonly env?: Readonly<Record<string, string>>
  readonly signal: AbortSignal
  readonly timeoutMs: number
  readonly onProgress?: (message: string) => void
  readonly passReason: string
  readonly failReason: string
  readonly failGuidance: string
}): Promise<VerifierResult> {
  opts.onProgress?.(`running: ${opts.command}`)
  const startedAt = Date.now()

  // Cross-platform shell: on Windows, prefer PowerShell so npm/bun/etc.
  // wrappers (.cmd / .ps1) resolve. Bun.spawn with `cmd: ["sh", "-c", ...]`
  // would fail on Windows without sh.
  const isWin = process.platform === "win32"
  const cmd = isWin
    ? ["powershell", "-NoProfile", "-NonInteractive", "-Command", opts.command]
    : ["sh", "-c", opts.command]

  const timeoutCtl = new AbortController()
  const timeoutHandle = setTimeout(() => timeoutCtl.abort(), opts.timeoutMs)
  const composite = anyAbortSignal([opts.signal, timeoutCtl.signal])

  let stdout = ""
  let stderr = ""
  let exitCode = -1
  let timedOut = false
  try {
    const proc = Bun.spawn(cmd, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdout: "pipe",
      stderr: "pipe",
      signal: composite,
    })
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    stdout = out
    stderr = err
    exitCode = code
    if (timeoutCtl.signal.aborted) timedOut = true
  } catch (e) {
    return {
      verifier: opts.name,
      status: "skip",
      reason: `failed to launch \`${opts.command}\`: ${e instanceof Error ? e.message : String(e)}`,
      durationMs: Date.now() - startedAt,
    }
  } finally {
    clearTimeout(timeoutHandle)
  }

  const durationMs = Date.now() - startedAt
  if (timedOut) {
    return {
      verifier: opts.name,
      status: "skip",
      reason: `command exceeded ${opts.timeoutMs}ms timeout`,
      durationMs,
    }
  }
  const combined = (stdout + (stderr ? `\n${stderr}` : "")).trim()
  if (exitCode === 0) {
    return {
      verifier: opts.name,
      status: "pass",
      reason: opts.passReason,
      details: { command: opts.command, exitCode },
      durationMs,
    }
  }
  return {
    verifier: opts.name,
    status: "fail",
    reason: `${opts.failReason} (exit ${exitCode})`,
    feedback: `${combined || "(no output)"}\n\n${opts.failGuidance}`,
    details: { command: opts.command, exitCode },
    durationMs,
  }
}

/** Compose multiple AbortSignals into one that aborts when any input aborts. */
function anyAbortSignal(signals: readonly AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any([...signals])
  // Polyfill for older runtimes.
  const ctl = new AbortController()
  for (const s of signals) {
    if (s.aborted) {
      ctl.abort(s.reason)
      return ctl.signal
    }
    s.addEventListener("abort", () => ctl.abort(s.reason), { once: true })
  }
  return ctl.signal
}
