/**
 * TUI driver — opentui + solid. Bootstraps the engine once via
 * `bootstrap()`, mounts the App, forwards engine events into the store,
 * and dispatches slash commands through the existing command handlers.
 */
import { render } from "@opentui/solid"
import { bootstrap } from "../bootstrap.ts"
import { App } from "./App.tsx"
import { createTuiStore } from "./state.ts"
import { tryDispatchCommand } from "../commands.ts"
import { findMatchingSkill, filterToolsBySkill, type Skill } from "@omni/improve"
import { looksDestructive } from "@omni/core"
import { createModalQueue } from "./modals/index.ts"
import { createToastStore } from "./Toast.tsx"
import { createAskUserTool } from "./askUserTool.ts"

export async function runTui(): Promise<void> {
  // Modal queue + toast store live outside the engine — they're surface
  // concerns. The permission gate funnels asks through `modals.push`.
  const modals = createModalQueue()
  const toasts = createToastStore()
  const askUserTool = createAskUserTool(modals)

  // Per-session "always" decisions for permission asks. Keyed by tool name.
  const sessionAllow = new Set<string>()
  const sessionDeny = new Set<string>()

  const deps = await bootstrap({
    askMode: "callback",
    askHandler: async (tool, call) => {
      // Session-level overrides shortcut the modal.
      if (sessionDeny.has(tool.name)) return "deny"
      if (sessionAllow.has(tool.name)) return "allow"
      const decision = await modals.push({
        kind: "permission",
        toolName: tool.name,
        toolDescription: tool.description,
        argsPreview: previewArgs(call.args),
        risk: looksDestructive(call.args) ? "this call may modify or delete files" : null,
      })
      if (decision === "allow-always") {
        sessionAllow.add(tool.name)
        toasts.push(`always-allow ${tool.name} this session`, "success")
        return "allow"
      }
      if (decision === "deny-always") {
        sessionDeny.add(tool.name)
        toasts.push(`always-deny ${tool.name} this session`, "warn")
        return "deny"
      }
      return decision === "allow" ? "allow" : "deny"
    },
    verbose: false,
    extraTools: [askUserTool],
  })

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
      const trimmed = text.trim()
      const name = trimmed.slice(1).split(/\s+/)[0]?.toLowerCase() ?? ""

      // TUI-specific overrides: some commands render as modal overlays
      // rather than chat output.
      if (name === "help") {
        await modals.push({ kind: "help" })
        return
      }
      if (name === "sessions" || name === "continue") {
        const rows = deps.sessions.list({ limit: 50 }).map((r) => ({
          id: r.id,
          model: r.model_id,
          status: r.status,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          turns: deps.messages.bySession(r.id).length,
        }))
        const picked = await modals.push({
          kind: "session-picker",
          rows,
          currentId: deps.engine.sessionId(),
        })
        if (picked === null || picked === "@new") return
        const ok = deps.continueSession(picked)
        if (ok) toasts.push(`resumed session ${picked.slice(-12)}`, "success")
        else toasts.push(`could not resume ${picked.slice(-12)}`, "error")
        return
      }
      if (name === "clear") {
        // Clear via modal-confirm to avoid accidental loss.
        const yes = await modals.push({
          kind: "confirm",
          title: "clear conversation history?",
          body: "this only clears the on-screen log; storage keeps everything.",
          confirmLabel: "clear",
          cancelLabel: "keep",
        })
        if (yes) {
          store.pushSystem("(screen cleared — full history still in storage)", "dim")
        }
        return
      }
      if (name === "ask-demo") {
        // Local demo of AskQuestionModal so you can see what the agent's
        // ask_user tool feels like.
        const answer = await modals.push({
          kind: "question",
          question: "Which approach do you prefer for the refactor?",
          context: "Different trade-offs; you can also type your own.",
          options: [
            {
              key: "1",
              label: "Drop-in JWT replacement",
              description: "Smallest diff; one file changed.",
              value: "jwt-drop-in",
            },
            {
              key: "2",
              label: "JWT + session store",
              description: "More work, but supports revocation.",
              value: "jwt-with-store",
            },
            {
              key: "3",
              label: "Keep basicAuth for now",
              description: "Defer the migration; just clean up the existing code.",
              value: "no-migration",
            },
          ],
          allowOther: true,
        })
        if (answer === null) toasts.push("question cancelled", "warn")
        else toasts.push(`answered: ${answer}`, "success")
        return
      }

      // Default: route to the existing command handlers, surface output as
      // a system message.
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
  // Mouse is OFF by default so the terminal's own click-drag selection /
  // copy keeps working. Keyboard scroll (pgup/pgdn, ctrl+u/d) works either
  // way. Set OMNI_MOUSE=1 to enable wheel-scroll (then use shift+drag for
  // native selection, which most terminals still honor).
  const useMouse = process.env.OMNI_MOUSE === "1"
  await render(
    () => (
      <App
        store={store}
        cwd={process.cwd()}
        sessionId={deps.engine.sessionId()}
        modals={modals}
        toasts={toasts}
        handlers={{
          onSubmit: handleSubmit,
          onAbort: handleAbort,
          onQuit: () => void shutdown(0),
        }}
      />
    ),
    { useMouse },
  )
}

function previewArgs(args: unknown): string {
  if (args === null || args === undefined) return "(no args)"
  let s: string
  if (typeof args === "string") s = JSON.stringify(args)
  else if (typeof args === "object") {
    try { s = JSON.stringify(args) } catch { s = String(args) }
  } else s = String(args)
  return s.length > 240 ? `${s.slice(0, 240)}…` : s
}
