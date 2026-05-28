import { describe, expect, test } from "bun:test"
import { platform } from "node:os"
import { bash, resolveShell, bashShell, setBashShellPref } from "../src/bash.ts"

const ctx = () => ({ cwd: process.cwd(), signal: new AbortController().signal })

// These tests spawn a real shell (pwsh on Windows / bash on POSIX). Shell
// cold-start under heavy concurrent load can exceed bun's default 5s per-test
// timeout, so give them generous headroom — the bash tool's own timeout (30s)
// is what actually bounds the command.
const SPAWN_TIMEOUT_MS = 30_000

describe("bash tool", () => {
  test(
    "runs a simple command",
    async () => {
      const r = await bash.execute({ command: "echo hello-omni" }, ctx())
      expect(r.exitCode).toBe(0)
      expect(r.stdout).toContain("hello-omni")
      expect(r.timedOut).toBe(false)
    },
    SPAWN_TIMEOUT_MS,
  )

  test(
    "strips ANSI escape sequences from output",
    async () => {
      const r = await bash.execute({ command: "echo plain" }, ctx())
      expect(r.stdout.includes("\x1b[")).toBe(false)
    },
    SPAWN_TIMEOUT_MS,
  )

  test(
    "non-zero exit is reported, not thrown",
    async () => {
      const r = await bash.execute({ command: "exit 3" }, ctx())
      expect(r.exitCode).not.toBe(0)
    },
    SPAWN_TIMEOUT_MS,
  )
})

describe("bash shell resolution", () => {
  const isWin = platform() === "win32"

  test("argv always carries the command verbatim as the last arg", () => {
    const argv = resolveShell().argv("echo hi")
    expect(argv.length).toBeGreaterThanOrEqual(2)
    expect(argv[argv.length - 1]).toBe("echo hi")
  })

  test.skipIf(isWin)("POSIX resolves to bash regardless of preference", () => {
    setBashShellPref("powershell")
    const r = resolveShell()
    expect(r.kind).toBe("bash")
    expect(r.family).toBe("posix")
    expect(r.isWindows).toBe(false)
    expect(r.argv("x")).toEqual(["bash", "-lc", "x"])
    expect(bashShell().family).toBe("posix")
    setBashShellPref("auto")
  })

  test.skipIf(!isWin)("Windows: forcing powershell yields the powershell family", () => {
    setBashShellPref("powershell")
    const r = resolveShell()
    expect(r.family).toBe("powershell")
    expect(["pwsh", "powershell"]).toContain(r.kind)
    setBashShellPref("auto")
  })

  test.skipIf(!isWin)("Windows: auto prefers Git Bash when installed (else PowerShell)", () => {
    setBashShellPref("auto")
    const r = resolveShell()
    if (r.kind === "gitbash") {
      expect(r.family).toBe("posix")
      expect(r.label).toContain("Git Bash")
      const argv = r.argv("x")
      expect(argv).toHaveLength(3)
      expect(argv[1]).toBe("-lc")
      expect(argv[2]).toBe("x")
    } else {
      expect(r.family).toBe("powershell")
    }
  })
})
