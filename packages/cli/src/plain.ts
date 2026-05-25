/**
 * Plain readline REPL — the no-TUI Omni surface.
 *
 * Importing this module runs the REPL via top-level await. The dispatcher
 * in `bin.ts` imports it when `--plain` is passed, when stdout isn't a
 * TTY (piped runs, CI), or when OMNI_PLAIN=1.
 *
 * Shares the engine bootstrap with the TUI via `bootstrap()` — the only
 * difference between the two surfaces is the I/O loop.
 */
import readline from "node:readline"
import { bootstrap } from "./bootstrap.ts"
import { renderEvent } from "./render.ts"
import { tryDispatchCommand } from "./commands.ts"
import { runTurn, type OrchestrationDeps, type OrchestrationSink } from "./orchestrate.ts"
import { confirm } from "./prompts.ts"
import { ansi } from "./ansi.ts"
import { findMatchingSkill, renderPlan, type Skill } from "@omni/improve"

// Permission prompts in plain mode go through a readline confirm().
const deps = await bootstrap({
  askMode: "callback",
  askHandler: async (tool, call) => {
    const argsPreview = truncate(JSON.stringify(call.args), 200)
    process.stdout.write("\n")
    const ok = await confirm(`Allow ${ansi.bold(tool.name)}(${ansi.dim(argsPreview)})?`, true)
    return ok ? "allow" : "deny"
  },
  verbose: true,
  onRequestBuildConfirm: async (plan) => {
    process.stdout.write("\n")
    if (plan) console.log(ansi.dim("proposed plan:\n" + plan))
    return confirm("Switch to build mode?", true)
  },
})

// ─── Active skill state ──────────────────────────────────────────────────
let activeSkill: Skill | null = null
let activeSkillSource: "manual" | "auto" | null = null
function applySkill(skill: Skill | null, source: "manual" | "auto" = "manual"): void {
  activeSkill = skill
  activeSkillSource = skill ? source : null
}

// ─── Banner ────────────────────────────────────────────────────────────────
console.log(
  `${ansi.bold("Omni")} ${ansi.dim(`(${deps.modelName}, ctx ${deps.adapter.capabilities.contextWindow})`)}`,
)
console.log(ansi.dim(`home: ${deps.paths.home}`))
if (deps.wsPaths) console.log(ansi.dim(`workspace: ${deps.wsPaths.home}`))
if (deps.activeProfile) {
  const flags = [
    deps.activeProfile.nativeToolCalls ? "native-tools" : "react-fallback",
    deps.activeProfile.followsInstructions ? "follows" : "loose",
    deps.activeProfile.verboseByDefault ? "verbose" : "terse",
  ].join(", ")
  console.log(ansi.dim(`probed: ${flags}`))
}
console.log(
  ansi.dim(
    `mode: ${deps.mode.get()} ${deps.mode.get() === "plan" ? "(read-only + planner)" : "(full tools + critic)"}`,
  ),
)
for (const w of deps.modelWarnings) console.log(ansi.yellow(`⚠ ${w}`))
console.log(
  ansi.dim("Type a message, or /help for commands, /quit to exit. /plan and /build switch modes."),
)
console.log()

// ─── Orchestration (shared planner/critic + mode-aware tool gating) ─────────
const orchestration: OrchestrationDeps = {
  engine: deps.engine,
  tools: deps.tools,
  planner: deps.planner,
  critic: deps.critic,
  criticAutoRetry: deps.criticAutoRetry,
  fileTracer: deps.fileTracer,
  recallMemory: deps.recallMemory,
}
const sink: OrchestrationSink = {
  onEngineEvent(ev) {
    const out = renderEvent(ev)
    if (out) process.stdout.write(out)
  },
  onPlan(plan) {
    process.stdout.write("\n" + ansi.dim("plan:\n" + renderPlan(plan)) + "\n")
  },
  onCritique(c, willRetry) {
    const color = c.verdict === "fail" ? ansi.red : c.verdict === "concern" ? ansi.yellow : ansi.dim
    const issues = c.issues.length ? "\n  - " + c.issues.join("\n  - ") : ""
    process.stdout.write(
      "\n" +
        color(`critique: ${c.verdict} (${c.score.toFixed(2)})${willRetry ? " — retrying" : ""}`) +
        ansi.dim(issues) +
        "\n",
    )
  },
  onInfo(text, tone) {
    const color = tone === "error" ? ansi.red : tone === "warn" ? ansi.yellow : ansi.dim
    process.stdout.write(color(text) + "\n")
  },
}

// ─── REPL ────────────────────────────────────────────────────────────────
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: ansi.bold("> "),
})

let currentRun: AbortController | null = null
let exiting = false
let cleaningUp = false

process.on("SIGINT", () => {
  if (currentRun) {
    console.log(ansi.dim("\n[ctrl-c — aborting current run]"))
    currentRun.abort()
  } else {
    if (cleaningUp) return
    console.log(ansi.dim("\nbye"))
    void shutdown(0)
  }
})

async function shutdown(code: number): Promise<never> {
  if (cleaningUp) process.exit(code)
  cleaningUp = true
  try {
    deps.sessions.setStatus(deps.engine.sessionId(), "completed")
    await deps.cleanup()
    rl.close()
  } catch (e) {
    console.error(ansi.red(`shutdown error: ${(e as Error).message}`))
  }
  process.exit(code)
}

async function run(): Promise<void> {
  rl.prompt()
  for await (const line of rl) {
    if (exiting) break
    const input = line.trim()
    if (!input) {
      rl.prompt()
      continue
    }

    // Skill auto-routing (same rules as the TUI).
    if (deps.skillAutoRoute && activeSkillSource !== "manual" && !input.startsWith("/")) {
      const eligible = [...deps.skills.values()].filter((s) => deps.skillsEnabled.has(s.name))
      const matched = findMatchingSkill(input, eligible)
      if (matched && matched.name !== activeSkill?.name) {
        applySkill(matched, "auto")
        console.log(ansi.dim(`[skill auto-activated: ${matched.name}]`))
      } else if (!matched && activeSkillSource === "auto") {
        applySkill(null, "auto")
        console.log(ansi.dim("[skill auto-cleared: no match]"))
      }
    }

    const cmdResult = await tryDispatchCommand(input, {
      engine: deps.engine,
      modelName: deps.modelName,
      profile: deps.activeProfile,
      strategy: deps.activeStrategy,
      skills: deps.skills,
      activeSkill,
      onSkillChange: applySkill,
      mcpManager: deps.mcpManager,
      sessionsRepo: deps.sessions,
      messagesRepo: deps.messages,
      onContinueSession: deps.continueSession,
      mode: deps.mode.get(),
      onModeChange: (m, s) => deps.mode.set(m, s ?? "manual"),
    })
    let effectiveInput = input
    if (cmdResult) {
      if (cmdResult.kind === "exit") {
        exiting = true
        break
      }
      if (cmdResult.kind === "message") {
        console.log(cmdResult.text)
        rl.prompt()
        continue
      }
      if (cmdResult.kind === "prompt") {
        effectiveInput = cmdResult.text
        console.log(ansi.dim(`[command rendered to ${effectiveInput.length} chars]`))
      }
    }

    currentRun = new AbortController()
    try {
      await runTurn(
        orchestration,
        effectiveInput,
        {
          mode: deps.mode.get(),
          activeSkill,
          strategy: deps.agentFlags,
          signal: currentRun.signal,
        },
        sink,
      )
    } catch (e) {
      console.error(ansi.red(`\nerror: ${(e as Error).message}`))
    } finally {
      currentRun = null
    }

    rl.prompt()
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

try {
  await run()
} catch (e) {
  console.error(ansi.red(`fatal: ${(e as Error).message}`))
  await shutdown(1)
}
await shutdown(0)
