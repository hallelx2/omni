import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import type { EngineEvent } from "@omni/core"
import { App } from "../src/tui/App.tsx"
import { createTuiStore } from "../src/tui/state.ts"
import { createModalQueue } from "../src/tui/modals/index.ts"
import { createToastStore } from "../src/tui/Toast.tsx"
import { createPermissionController } from "../src/tui/PermissionPrompt.tsx"

/**
 * Headless render smoke tests. opentui's `testRender` mounts the real
 * component tree into an off-screen TestRenderer (no TTY needed) and lets
 * us capture the painted character frame. These prove the redesigned TUI
 * actually *renders* at runtime — RGBA theme, borders, spinner timers,
 * the uncontrolled <textarea>, markdown, per-tool rows, inline permission,
 * and the shimmering working indicator — not just that it typechecks.
 */

function harness() {
  const store = createTuiStore({ modelName: "mock-model", mcpServers: 1, mode: "build" })
  const modals = createModalQueue()
  const toasts = createToastStore()
  const permission = createPermissionController()
  const handlers = { onSubmit: () => {}, onAbort: () => {}, onQuit: () => {} }
  return { store, modals, toasts, permission, handlers }
}

const ev = (e: Record<string, unknown>) => e as unknown as EngineEvent

async function frameOf(node: () => unknown) {
  const r = await testRender(node as never)
  r.resize(120, 40)
  await r.renderOnce()
  return r.captureCharFrame()
}

describe("TUI renders headlessly", () => {
  test("landing screen paints the brand + tagline", async () => {
    const h = harness()
    const frame = await frameOf(() => (
      <App store={h.store} handlers={h.handlers} cwd="/tmp/project" sessionId="sess_abc123"
        modals={h.modals} toasts={h.toasts} permission={h.permission} />
    ))
    expect(frame.length).toBeGreaterThan(0)
    expect(frame).toContain("agent harness")
    expect(frame).toContain("commands")
  })

  test("tool rows render as components (no raw JSON)", async () => {
    const h = harness()
    h.store.pushUser("list files")
    h.store.pushEvent(ev({ type: "model.start" }))
    h.store.pushEvent(ev({ type: "model.delta", text: "On it." }))
    h.store.pushEvent(ev({ type: "model.done" }))
    h.store.pushEvent(ev({ type: "tool.start", call: { id: "g1", name: "glob", args: { pattern: "**/*.ts", root: "/x" } } }))
    h.store.pushEvent(ev({ type: "tool.result", call: { id: "g1", name: "glob", args: {} }, result: ["a.ts", "b.ts"], durationMs: 7 }))
    h.store.pushEvent(ev({ type: "tool.start", call: { id: "b1", name: "bash", args: { command: "ls -la" } } }))
    h.store.pushEvent(ev({ type: "tool.result", call: { id: "b1", name: "bash", args: {} }, result: { stdout: "file.txt\n", stderr: "", exitCode: 0 }, durationMs: 12 }))

    const frame = await frameOf(() => (
      <App store={h.store} handlers={h.handlers} cwd="/tmp/project" sessionId="s"
        modals={h.modals} toasts={h.toasts} permission={h.permission} />
    ))
    // human labels, not JSON
    expect(frame).toContain('Glob "**/*.ts"')
    expect(frame).toContain("ls -la")
    // the args object must NOT be dumped as JSON anywhere
    expect(frame).not.toContain('{"pattern"')
    expect(frame).not.toContain('"root"')
  })

  test("inline permission prompt renders above the input (not a modal)", async () => {
    const h = harness()
    h.store.pushUser("run a command") // a permission only ever happens mid-conversation
    void h.permission.request({
      toolName: "bash",
      toolDescription: "run a shell command",
      args: { command: "rm -rf build" },
      risk: "this call may modify or delete files",
    })
    const frame = await frameOf(() => (
      <App store={h.store} handlers={h.handlers} cwd="/tmp" sessionId="s"
        modals={h.modals} toasts={h.toasts} permission={h.permission} />
    ))
    expect(frame).toContain("permission")
    expect(frame).toContain("allow")
    expect(frame).toContain("rm -rf build")
    expect(frame).not.toContain('{"command"')
  })

  test("working indicator shows a gerund while running", async () => {
    const h = harness()
    h.store.pushUser("do a thing")
    h.store.pushEvent(ev({ type: "engine.start", sessionId: "s", input: "x" }))
    h.store.pushEvent(ev({ type: "engine.iteration", iteration: 1, maxIterations: 12 }))
    const frame = await frameOf(() => (
      <App store={h.store} handlers={h.handlers} cwd="/tmp" sessionId="s"
        modals={h.modals} toasts={h.toasts} permission={h.permission} />
    ))
    // a gerund ends in "…" and the run state shows the interrupt affordance
    expect(frame).toContain("…")
    expect(frame).toContain("interrupt")
  })
})
