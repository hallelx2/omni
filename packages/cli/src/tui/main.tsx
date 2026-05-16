/**
 * TUI driver — opentui + solid. Bootstraps the engine once via
 * `bootstrap()`, mounts the App, forwards engine events into the store,
 * and dispatches slash commands through the existing command handlers.
 */
import { resolve } from "node:path"
import { render } from "@opentui/solid"
import { bootstrap } from "../bootstrap.ts"
import { App } from "./App.tsx"
import { createTuiStore } from "./state.ts"
import { tryDispatchCommand } from "../commands.ts"
import { findMatchingSkill, filterToolsBySkill, type Skill } from "@omni/improve"

export async function runTui(): Promise<void> {
  // For v1 the TUI auto-allows tool permissions — a confirmation modal
  // belongs in a later commit. The audit log still records every decision
  // so you can see what ran.
  const deps = await bootstrap({ askMode: "allow", verbose: false })

  const store = createTuiStore({
    modelName: deps.modelName,
    mcpServers: deps.mcpManager.status().filter((s) => s.status === "connected").length,
  })

  if (deps.activeProfile) {
    store.setProfile({
      nativeTools: deps.activeProfile.nativeToolCalls,
      follows: deps.activeProfile.followsInstructions,
      verbose: deps.activeProfile.verboseByDefault,
    })
  }

  // ─── Active skill state (lives outside the store; the store only reflects
  //     the name for display).
  let activeSkill: Skill | null = null
  let activeSkillSource: "manual" | "auto" | null = null
  function applySkill(skill: Skill | null, source: "manual" | "auto" = "manual"): void {
    activeSkill = skill
    activeSkillSource = skill ? source : null
    store.setSkillName(skill?.name ?? null)
  }

  // ─── Run-state (one engine.run() at a time)
  let currentRun: AbortController | null = null

  async function startEngineRun(text: string): Promise<void> {
    // Auto-route to a skill on each user prompt unless:
    //   - auto-route is disabled
    //   - the user manually pinned a skill via /skill (sticky)
    //   - the input is itself a slash command
    if (deps.skillAutoRoute && activeSkillSource !== "manual" && !text.startsWith("/")) {
      const eligible = [...deps.skills.values()].filter((s) => deps.skillsEnabled.has(s.name))
      const matched = findMatchingSkill(text, eligible)
      if (matched && matched.name !== activeSkill?.name) {
        applySkill(matched, "auto")
        store.pushSystem(`skill auto-activated: ${matched.name}`, "dim")
      } else if (!matched && activeSkillSource === "auto") {
        applySkill(null, "auto")
        store.pushSystem("skill auto-cleared (no match)", "dim")
      }
    }

    store.pushUser(text)

    currentRun = new AbortController()
    const runOpts: { signal: AbortSignal; systemPromptPrefix?: string; enabledTools?: Set<string> } = {
      signal: currentRun.signal,
    }
    if (activeSkill) {
      runOpts.systemPromptPrefix = activeSkill.systemPrompt
      if (activeSkill.toolsOnly) {
        const allowed = new Set<string>()
        for (const t of filterToolsBySkill(deps.tools, activeSkill)) allowed.add(t.name)
        runOpts.enabledTools = allowed
      }
    }
    try {
      for await (const ev of deps.engine.run(text, runOpts)) {
        store.pushEvent(ev)
        if (deps.fileTracer) deps.fileTracer.record(ev)
      }
    } catch (e) {
      store.pushSystem(`error: ${(e as Error).message}`, "error")
    } finally {
      currentRun = null
    }
  }

  async function handleSubmit(text: string): Promise<void> {
    if (text.startsWith("/")) {
      // Slash command — dispatch through the existing handlers. We surface
      // their output as system messages instead of writing to stdout.
      const cmd = await tryDispatchCommand(text, {
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
        onContinueSession: (id) => deps.continueSession(id),
      })
      if (!cmd) {
        store.pushSystem(`unknown command. type /help to list.`, "warn")
        return
      }
      if (cmd.kind === "exit") {
        await shutdown(0)
        return
      }
      if (cmd.kind === "message") {
        store.pushSystem(cmd.text, "info")
        return
      }
      if (cmd.kind === "prompt") {
        // The command rendered to a prompt to feed the engine.
        await startEngineRun(cmd.text)
        return
      }
      return
    }
    await startEngineRun(text)
  }

  function handleAbort(): void {
    if (currentRun) {
      currentRun.abort()
      store.pushSystem("aborted", "dim")
    }
  }

  let cleaningUp = false
  async function shutdown(code: number): Promise<never> {
    if (cleaningUp) process.exit(code)
    cleaningUp = true
    try {
      await deps.cleanup()
    } catch (e) {
      console.error(`shutdown error: ${(e as Error).message}`)
    }
    process.exit(code)
  }

  process.on("SIGINT", () => {
    if (currentRun) handleAbort()
    else void shutdown(0)
  })

  // ─── Mount the TUI ───────────────────────────────────────────────────────
  await render(() => (
    <App
      store={store}
      cwd={process.cwd()}
      handlers={{
        onSubmit: handleSubmit,
        onAbort: handleAbort,
        onQuit: () => void shutdown(0),
      }}
    />
  ))
}
