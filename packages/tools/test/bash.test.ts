import { describe, expect, test } from "bun:test"
import { bash } from "../src/bash.ts"

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
