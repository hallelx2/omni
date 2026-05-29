/**
 * TUI driver — opentui + solid.
 *
 * The UI paints IMMEDIATELY: `runTui` mounts a boot screen and kicks off
 * `bootstrap()` in the BACKGROUND (it connects MCP servers and probes the
 * model, which can take seconds). When bootstrap resolves we swap in the
 * full chat app; if it fails we show an error screen instead of crashing.
 */
import { render, useTerminalDimensions, useRenderer } from "@opentui/solid"
import { Show, createSignal, onMount, onCleanup } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { bootstrap, type BootstrapResult } from "../bootstrap.ts"
import { App } from "./App.tsx"
import { createTuiStore } from "./state.ts"
import { tryDispatchCommand } from "../commands.ts"
import { findMatchingSkill, renderPlan, type Skill } from "@omni/improve"
import { looksDestructive } from "@omni/core"
import { runTurn, type OrchestrationDeps, type OrchestrationSink } from "../orchestrate.ts"
import { agentToolName } from "../agents-runtime.ts"
import { createModalQueue, type ModalQueue } from "./modals/index.ts"
import { createToastStore, type ToastStore } from "./Toast.tsx"
import { createAskUserTool } from "./askUserTool.ts"
import { createPermissionController, type PermissionController } from "./PermissionPrompt.tsx"
import { Spinner } from "./Spinner.tsx"
import { theme } from "./theme.ts"

export async function runTui(): Promise<void> {
  // Surface concerns — they don't need the engine, so they exist before
  // bootstrap and are captured by both the boot screen and the chat app.
  const modals = createModalQueue()
  const toasts = createToastStore()
  const permission = createPermissionController()
  const askUserTool = createAskUserTool(modals)
  const sessionAllow = new Set<string>()
  const sessionDeny = new Set<string>()

  const [deps, setDeps] = createSignal<BootstrapResult | null>(null)
  const [bootError, setBootError] = createSignal<Error | null>(null)
  const [bootStep, setBootStep] = createSignal("starting…")
  const cwd = process.cwd()

  // Name the terminal "omni" right away (before the engine is up). The first
  // message replaces this with a session title (see startEngineRun).
  try {
    process.stdout.write("\x1b]0;omni\x07")
  } catch {
    // ignore — title is cosmetic
  }

  // Fire-and-forget: bootstrap runs while the boot screen is already painted.
  void bootstrap({
    askMode: "callback",
    askHandler: async (tool, call) => {
      if (sessionDeny.has(tool.name)) return "deny"
      if (sessionAllow.has(tool.name)) return "allow"
      const decision = await permission.request({
        toolName: tool.name,
        toolDescription: tool.description,
        args: call.args,
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
    onProgress: (step) => setBootStep(step),
    onRequestBuildConfirm: async (plan) => {
      const yes = await modals.push({
        kind: "confirm",
        title: "switch to build mode?",
        body: plan ? `Plan:\n${plan}` : "The agent wants to start making changes.",
        confirmLabel: "build",
        cancelLabel: "stay in plan",
      })
      return yes === true
    },
  })
    .then((d) => setDeps(d))
    .catch((e) => setBootError(e instanceof Error ? e : new Error(String(e))))

  const useMouse = process.env.OMNI_MOUSE !== "0"
  await render(
    () => (
      <Show
        when={deps()}
        fallback={<BootScreen step={bootStep()} error={bootError()} cwd={cwd} />}
      >
        <ChatApp deps={deps()!} modals={modals} toasts={toasts} permission={permission} />
      </Show>
    ),
    // opencode's idiom: default (alternate) screen, our handlers own Ctrl-C
    // (so it routes to shutdown → clears the screen).
    { useMouse, exitOnCtrlC: false },
  )
}

/** A concise terminal/session title derived from the first user message. */
function deriveSessionTitle(s: string): string {
  const t = s.replace(/\s+/g, " ").trim()
  if (!t) return "omni"
  return t.length > 50 ? t.slice(0, 50).trimEnd() + "…" : t
}

// ─── Boot screen (painted instantly while bootstrap runs) ───────────────────

function BootScreen(props: { step: string; error: Error | null; cwd: string }) {
  const dims = useTerminalDimensions()
  return (
    <box
      width={dims().width}
      height={dims().height}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      backgroundColor={theme.background}
    >
      <text fg={theme.primary} attributes={TextAttributes.BOLD}>
        ● omni
      </text>
      <box height={1} />
      <Show
        when={props.error}
        fallback={<Spinner color={theme.textMuted}>{props.step}</Spinner>}
      >
        <box flexDirection="column" alignItems="center">
          <text fg={theme.error}>startup failed</text>
          <text fg={theme.textMuted}>{props.error?.message}</text>
          <box height={1} />
          <text fg={theme.textMuted}>ctrl+c to exit</text>
        </box>
      </Show>
      <box height={1} />
      <text fg={theme.textMuted}>{props.cwd}</text>
    </box>
  )
}

// ─── Chat app (mounts once bootstrap resolves) ──────────────────────────────

function ChatApp(props: {
  deps: BootstrapResult
  modals: ModalQueue
  toasts: ToastStore
  permission: PermissionController
}) {
  const deps = props.deps
  const { modals, toasts, permission } = props

  const store = createTuiStore({
    modelName: deps.modelName,
    mcpServers: deps.mcpManager.status().filter((s) => s.status === "connected").length,
    mode: deps.mode.get(),
    agentNames: new Set([...[...deps.agents.keys()].map(agentToolName), "dispatch_agents"]),
  })
  const unsubMode = deps.mode.subscribe((m) => store.setMode(m))
  onCleanup(() => unsubMode())
  for (const w of deps.modelWarnings) store.pushSystem(`⚠ ${w}`, "warn")

  if (deps.activeProfile) {
    store.setProfile({
      nativeTools: deps.activeProfile.nativeToolCalls,
      follows: deps.activeProfile.followsInstructions,
      verbose: deps.activeProfile.verboseByDefault,
    })
  }

  const renderer = useRenderer()

  // ─── Active skill state (lives outside the store; the store only reflects
  //     the name for display).
  let activeSkill: Skill | null = null
  let activeSkillSource: "manual" | "auto" | null = null
  function applySkill(skill: Skill | null, source: "manual" | "auto" = "manual"): void {
    activeSkill = skill
    activeSkillSource = skill ? source : null
    store.setSkillName(skill?.name ?? null)
  }

  // ─── Shared orchestration (planner/critic + mode-aware tool gating) ──────
  const orchestration: OrchestrationDeps = {
    engine: deps.engine,
    tools: deps.tools,
    planner: deps.planner,
    critic: deps.critic,
    criticAutoRetry: deps.criticAutoRetry,
    fileTracer: deps.fileTracer,
    recallMemory: deps.recallMemory,
    activeVariantText: deps.activeVariantText,
  }
  const sink: OrchestrationSink = {
    onEngineEvent: (ev) => store.pushEvent(ev),
    onPlan: (plan) => store.pushSystem("plan:\n" + renderPlan(plan), "info"),
    onCritique: (c, willRetry) => {
      const tone = c.verdict === "fail" ? "error" : c.verdict === "concern" ? "warn" : "dim"
      const issues = c.issues.length ? "\n- " + c.issues.join("\n- ") : ""
      store.pushSystem(
        `critique: ${c.verdict} (${c.score.toFixed(2)})${willRetry ? " — retrying" : ""}${issues}`,
        tone,
      )
    },
    onInfo: (text, tone) =>
      store.pushSystem(text, tone === "error" ? "error" : tone === "warn" ? "warn" : "dim"),
  }

  // ─── Run-state (one engine.run() at a time)
  let currentRun: AbortController | null = null
  let sessionTitled = false

  async function startEngineRun(text: string): Promise<void> {
    // First prompt of the session names the terminal after it.
    if (!sessionTitled) {
      sessionTitled = true
      const title = deriveSessionTitle(text)
      if (title) renderer.setTerminalTitle(title)
    }
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
    try {
      await runTurn(
        orchestration,
        text,
        {
          mode: deps.mode.get(),
          activeSkill,
          strategy: deps.agentFlags,
          signal: currentRun.signal,
        },
        sink,
      )
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
        mode: deps.mode.get(),
        onModeChange: (m, s) => deps.mode.set(m, s ?? "manual"),
        variantsRepo: deps.variants,
        evolveModelId: deps.evolveModelId,
        activeVariantId: deps.activeVariantId,
        evolveMode: deps.evolveMode,
        evolveEnabled: deps.config.improve?.evolve?.enabled === true,
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
    if (currentRun && !currentRun.signal.aborted) {
      currentRun.abort()
      store.pushSystem("interrupting…", "dim")
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
    // Tear down the renderer, then wipe the screen + scrollback for a clean exit.
    try {
      renderer.destroy()
    } catch {
      // ignore
    }
    try {
      process.stdout.write("\x1b[2J\x1b[3J\x1b[H")
    } catch {
      // ignore
    }
    process.exit(code)
  }

  onMount(() => {
    renderer.setTerminalTitle("omni")
    const onSig = () => {
      if (currentRun) handleAbort()
      else void shutdown(0)
    }
    process.on("SIGINT", onSig)
    onCleanup(() => process.off("SIGINT", onSig))
  })

  return (
    <App
      store={store}
      cwd={process.cwd()}
      sessionId={deps.engine.sessionId()}
      modals={modals}
      toasts={toasts}
      permission={permission}
      handlers={{
        onSubmit: handleSubmit,
        onAbort: handleAbort,
        onQuit: () => void shutdown(0),
      }}
    />
  )
}
