import { z } from "zod"
import { platform } from "node:os"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Tool, ToolContext } from "@omni/core"
import { clip } from "./util/clip.ts"

export type ShellKind = "pwsh" | "powershell" | "gitbash" | "bash"
export type ShellFamily = "powershell" | "posix"
/** User preference for which shell the bash tool runs through (config `bash.shell`). */
export type ShellPref = "auto" | "powershell" | "gitbash"

// Windows PowerShell flavor — detected once (stable for the process).
const WINDOWS_PS: readonly string[] = Bun.which("pwsh")
  ? ["pwsh", "-NoProfile", "-NonInteractive", "-Command"]
  : ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command"]

// Process-wide preference, seeded from env; bootstrap/runtime override from config.
let shellPref: ShellPref = (() => {
  const v = (process.env.OMNI_BASH_SHELL ?? "").toLowerCase()
  return v === "powershell" || v === "gitbash" || v === "auto" ? (v as ShellPref) : "auto"
})()

/** Set which shell the bash tool runs through (from config `bash.shell`). No-op for undefined. */
export function setBashShellPref(pref?: ShellPref | string): void {
  if (!pref) return
  const v = String(pref).toLowerCase()
  if (v === "powershell" || v === "gitbash" || v === "auto") shellPref = v as ShellPref
}

// Git Bash location, found lazily once. `git --exec-path` is the robust locator —
// it resolves through scoop/winget shims to the real install, unlike hardcoded
// paths or deriving from the git shim. WSL's System32\bash.exe is excluded.
let _gitBash: string | null | undefined
function gitBashPath(): string | null {
  if (_gitBash !== undefined) return _gitBash
  _gitBash = findGitBash()
  return _gitBash
}
function findGitBash(): string | null {
  if (platform() !== "win32") return null
  const ok = (p: string | null | undefined): string | null =>
    p && existsSync(p) && !/[\\/]system32[\\/]/i.test(p) ? p : null

  try {
    const res = Bun.spawnSync(["git", "--exec-path"])
    if (res.success) {
      const execPath = res.stdout.toString().trim() // <root>/mingw64/libexec/git-core
      if (execPath) {
        const root = dirname(dirname(dirname(execPath)))
        const hit = ok(join(root, "usr", "bin", "bash.exe")) ?? ok(join(root, "bin", "bash.exe"))
        if (hit) return hit
      }
    }
  } catch {
    // git not on PATH — fall through to fixed locations
  }

  const pf = process.env["ProgramFiles"] ?? "C:\\Program Files"
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)"
  const local = process.env["LOCALAPPDATA"]
  const home = process.env["USERPROFILE"]
  const candidates = [
    join(pf, "Git", "bin", "bash.exe"),
    join(pf86, "Git", "bin", "bash.exe"),
    local ? join(local, "Programs", "Git", "bin", "bash.exe") : null,
    home ? join(home, "scoop", "apps", "git", "current", "usr", "bin", "bash.exe") : null,
  ]
  for (const c of candidates) {
    const hit = ok(c)
    if (hit) return hit
  }
  return null
}

export interface ResolvedShell {
  readonly kind: ShellKind
  readonly label: string
  readonly family: ShellFamily
  readonly isWindows: boolean
  /** Build the spawn argv for a command string. */
  argv(command: string): string[]
}

/**
 * The shell the `bash` tool actually runs commands through — so the harness can
 * tell the model the truth and the model writes commands in the right syntax.
 * On Windows, "auto" prefers Git Bash when installed (so Linux-level commands
 * work), else PowerShell. POSIX always uses bash.
 */
export function resolveShell(pref: ShellPref = shellPref): ResolvedShell {
  if (platform() !== "win32") {
    return { kind: "bash", label: "bash", family: "posix", isWindows: false, argv: (c) => ["bash", "-lc", c] }
  }
  const gb = pref === "powershell" ? null : gitBashPath()
  if (gb && (pref === "gitbash" || pref === "auto")) {
    return {
      kind: "gitbash",
      label: `Git Bash (${gb})`,
      family: "posix",
      isWindows: true,
      // -lc: login shell sources /etc/profile so /usr/bin (sed, awk, grep, …) is
      // on PATH even when spawned from a Windows process; cwd is preserved.
      argv: (c) => [gb, "-lc", c],
    }
  }
  const kind: ShellKind = WINDOWS_PS[0] === "pwsh" ? "pwsh" : "powershell"
  return {
    kind,
    label: kind === "pwsh" ? "PowerShell 7+ (pwsh)" : "Windows PowerShell (powershell.exe)",
    family: "powershell",
    isWindows: true,
    argv: (c) => [...WINDOWS_PS, c],
  }
}

/**
 * Metadata about the shell the `bash` tool runs through, for the system prompt.
 */
export function bashShell(
  pref?: ShellPref,
): { readonly kind: ShellKind; readonly label: string; readonly family: ShellFamily; readonly isWindows: boolean } {
  const r = resolveShell(pref)
  return { kind: r.kind, label: r.label, family: r.family, isWindows: r.isWindows }
}

/**
 * Strip CSI/OSC ANSI escape sequences. Shells (especially pwsh) inject these
 * for color; they're noise in machine-readable tool results and confuse the
 * model when it tries to parse output.
 */
const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /[][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?|(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g
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
 * Cross-platform shell command tool. Runs through the resolved shell:
 * bash on POSIX; Git Bash or PowerShell on Windows ({@link resolveShell}).
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
    const argv = resolveShell().argv(args.command)

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
