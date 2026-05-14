import { z } from "zod"
import { platform } from "node:os"
import type { Tool, ToolContext } from "@omni/core"
import { clip } from "./util/clip.ts"

// Cached at module load — pwsh detection is stable for the process lifetime.
const WINDOWS_SHELL: readonly string[] = (() => {
  if (Bun.which("pwsh")) return ["pwsh", "-NoProfile", "-NonInteractive", "-Command"]
  return ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command"]
})()

function pickWindowsShell(): readonly string[] {
  return WINDOWS_SHELL
}

/**
 * Strip CSI/OSC ANSI escape sequences. Shells (especially pwsh) inject these
 * for color; they're noise in machine-readable tool results and confuse the
 * model when it tries to parse output.
 */
const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /[][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?|(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "")
}

export const BashArgs = z.object({
  command: z.string().min(1).describe("The shell command to execute."),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(600_000)
    .optional()
    .describe("Timeout in milliseconds (default 30000, max 600000)."),
})

export type BashArgs = z.infer<typeof BashArgs>

export interface BashResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
  readonly timedOut: boolean
  readonly truncated: boolean
}

const MAX_OUTPUT_BYTES = 256_000

/**
 * Cross-platform shell command tool.
 * Uses bash on POSIX; powershell on Windows; tolerates both calling conventions.
 * Output is hard-capped at {@link MAX_OUTPUT_BYTES} per stream to prevent
 * drowning the model's context with large captures.
 */
export const bash: Tool<BashArgs, BashResult> = {
  name: "bash",
  description:
    "Execute a shell command in the working directory. Returns stdout, stderr, and exit code. Long output is truncated.",
  permission: "ask",
  schema: BashArgs,
  async execute(args, ctx: ToolContext): Promise<BashResult> {
    const timeoutMs = args.timeoutMs ?? 30_000
    const isWindows = platform() === "win32"
    const argv = isWindows
      ? [...pickWindowsShell(), args.command]
      : ["bash", "-lc", args.command]

    const ctrl = new AbortController()
    const onParentAbort = () => ctrl.abort()
    ctx.signal.addEventListener("abort", onParentAbort, { once: true })
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const startedAt = Date.now()

    try {
      const proc = Bun.spawn(argv, {
        cwd: ctx.cwd,
        env: ctx.env ?? (process.env as Record<string, string>),
        stdout: "pipe",
        stderr: "pipe",
        signal: ctrl.signal,
      })

      const [stdoutRaw, stderrRaw, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])

      const truncatedStdout = clip(stripAnsi(stdoutRaw), MAX_OUTPUT_BYTES)
      const truncatedStderr = clip(stripAnsi(stderrRaw), MAX_OUTPUT_BYTES)
      const timedOut = ctrl.signal.aborted && !ctx.signal.aborted && Date.now() - startedAt >= timeoutMs

      return {
        stdout: truncatedStdout.text,
        stderr: truncatedStderr.text,
        exitCode,
        timedOut,
        truncated: truncatedStdout.truncated || truncatedStderr.truncated,
      }
    } finally {
      clearTimeout(timer)
      ctx.signal.removeEventListener("abort", onParentAbort)
    }
  },
}

