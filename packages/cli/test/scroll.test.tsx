import { expect, test, describe } from "bun:test"
import { testRender } from "@opentui/solid"
import { App } from "../src/tui/App.tsx"
import { createTuiStore } from "../src/tui/state.ts"
import { createModalQueue } from "../src/tui/modals/index.ts"
import { createToastStore } from "../src/tui/Toast.tsx"
import { createPermissionController } from "../src/tui/PermissionPrompt.tsx"

function mount() {
  const store = createTuiStore({ modelName: "m", mcpServers: 0, mode: "build" })
  const modals = createModalQueue()
  const toasts = createToastStore()
  const permission = createPermissionController()
  for (let i = 0; i < 50; i++) store.pushUser(`message number ${i} ${"x".repeat(10)}`)
  return testRender(() => (
    <App
      store={store}
      handlers={{ onSubmit() {}, onAbort() {}, onQuit() {} }}
      cwd="/tmp"
      sessionId="s"
      modals={modals}
      toasts={toasts}
      permission={permission}
    />
  ))
}

describe("scroll the transcript", () => {
  test("wheel over the message area", async () => {
    const r = await mount()
    r.resize(120, 40)
    await r.renderOnce()
    const before = r.captureCharFrame()
    for (let i = 0; i < 5; i++) {
      await r.mockMouse.scroll(10, 10, "up")
      await r.renderOnce()
    }
    expect(r.captureCharFrame()).not.toBe(before)
  })

  test("wheel over the input area (catch-all handler)", async () => {
    const r = await mount()
    r.resize(120, 40)
    await r.renderOnce()
    const before = r.captureCharFrame()
    for (let i = 0; i < 6; i++) {
      await r.mockMouse.scroll(10, 35, "up")
      await r.renderOnce()
    }
    expect(r.captureCharFrame()).not.toBe(before)
  })

  // Empty input, so Ctrl+U's textarea binding (delete-to-line-start) is a
  // no-op and the only thing that can change the frame is the App's scroll.
  test("keyboard Ctrl+U scrolls with the textarea focused", async () => {
    const r = await mount()
    r.resize(120, 40)
    await r.renderOnce()
    const before = r.captureCharFrame()
    r.mockInput.pressKey("u", { ctrl: true })
    r.mockInput.pressKey("u", { ctrl: true })
    r.mockInput.pressKey("u", { ctrl: true })
    await r.renderOnce()
    expect(r.captureCharFrame()).not.toBe(before)
  })
})
