import { describe, expect, test } from "bun:test"
import { buildSystemPrompt } from "../src/index.ts"

describe("buildSystemPrompt — environment", () => {
  test("includes shell label, OS, arch, and git in the environment block", () => {
    const p = buildSystemPrompt({
      cwd: "/work/proj",
      shell: "PowerShell 7+ (pwsh)",
      shellFamily: "powershell",
      osVersion: "10.0.26200",
      arch: "x64",
      isGitRepo: true,
    })
    expect(p).toContain("PowerShell 7+ (pwsh)")
    expect(p).toContain("x64")
    expect(p).toContain("10.0.26200")
    expect(p).toContain("(git repo)")
  })

  test("powershell family adds concrete syntax rules", () => {
    const p = buildSystemPrompt({ shellFamily: "powershell" })
    expect(p).toContain("SHELL: POWERSHELL")
    expect(p).toContain("$null")
    expect(p).toContain("$env:NAME")
  })

  test("posix family adds the bash block, not the powershell one", () => {
    const p = buildSystemPrompt({ shellFamily: "posix" })
    expect(p).toContain("SHELL: BASH")
    expect(p).not.toContain("SHELL: POWERSHELL")
  })

  test("no shell block when family is unset", () => {
    const p = buildSystemPrompt({})
    expect(p).not.toContain("SHELL: POWERSHELL")
    expect(p).not.toContain("SHELL: BASH")
  })

  test("carries the token-economy + exploration rules", () => {
    const p = buildSystemPrompt({})
    expect(p).toContain("SPEND TOKENS LIKE MONEY")
    expect(p).toContain("EXPLORING A CODEBASE")
    expect(p).toContain("contracts over implementations")
  })

  test("carries the finish-the-job rule", () => {
    expect(buildSystemPrompt({})).toContain("FINISH THE JOB")
  })

  test("teaches subagent delegation only when dispatch_agents is available", () => {
    const withDispatch = buildSystemPrompt({
      tools: [{ name: "dispatch_agents", description: "fan out to search subagents" }],
    })
    expect(withDispatch).toContain("DELEGATE EXPLORATION")

    const without = buildSystemPrompt({
      tools: [{ name: "grep", description: "search file contents" }],
    })
    expect(without).not.toContain("DELEGATE EXPLORATION")
  })
})
