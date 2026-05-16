/**
 * Standalone TUI smoke test. Renders the full shell with a fake store so
 * we can iterate on the layout without spinning up a real engine.
 *
 *   bun packages/cli/src/tui/demo.tsx
 */
import { render } from "@opentui/solid"
import { App } from "./App.tsx"
import { createTuiStore } from "./state.ts"
import { createModalQueue } from "./modals/index.ts"
import { createToastStore } from "./Toast.tsx"

const store = createTuiStore({ modelName: "mimo-2.5", mcpServers: 2 })

// Seed the store with the kind of session you'd see mid-run.
store.setProfile({ nativeTools: true, follows: true, verbose: false })
store.setSkillName("typescript")

store.pushUser("refactor src/auth.ts to use JWT instead of basicAuth")

store.pushEvent({ type: "engine.start", sessionId: "demo", input: "refactor..." })
store.pushEvent({ type: "engine.iteration", iteration: 1, maxIterations: 12 })
store.pushEvent({ type: "model.start", modelId: "mimo-2.5" })
store.pushEvent({ type: "model.delta", text: "I'll read the auth module first to see what we're working with.\n" })
store.pushEvent({ type: "model.done", finishReason: "tool_calls" })

const call1 = { id: "c1", name: "read_file", args: { path: "src/auth.ts" } }
store.pushEvent({ type: "tool.start", call: call1 })
store.pushEvent({ type: "tool.result", call: call1, result: "248 lines, exports login/logout/verify", durationMs: 12 })

store.pushEvent({ type: "engine.iteration", iteration: 2, maxIterations: 12 })
store.pushEvent({ type: "model.start", modelId: "mimo-2.5" })
store.pushEvent({ type: "model.delta", text: "Now patching it to swap basicAuth for jwt.sign:" })
store.pushEvent({ type: "model.done", finishReason: "tool_calls" })

const call2 = { id: "c2", name: "apply_patch", args: { patch: "...diff..." } }
store.pushEvent({ type: "tool.start", call: call2 })
store.pushEvent({
  type: "tool.result",
  call: call2,
  result: { applied: [{ path: "src/auth.ts", action: "modified" }], failed: [] },
  durationMs: 8,
})
store.pushEvent({ type: "verifier.start", call: call2, verifier: "patch-applies" })
store.pushEvent({ type: "verifier.result", call: call2, verifier: "patch-applies", status: "pass", durationMs: 4 })
store.pushEvent({ type: "verifier.start", call: call2, verifier: "file-parses" })
store.pushEvent({ type: "verifier.result", call: call2, verifier: "file-parses", status: "pass", durationMs: 12 })
store.pushEvent({ type: "verifier.start", call: call2, verifier: "typecheck" })
store.pushEvent({
  type: "verifier.result",
  call: call2,
  verifier: "typecheck",
  status: "fail",
  reason: "SECRET is not defined at src/auth.ts:14",
  feedback: "TS2304: Cannot find name 'SECRET'. Did you mean 'process.env.SECRET'?",
  durationMs: 1200,
})

store.pushEvent({ type: "engine.iteration", iteration: 3, maxIterations: 12 })
store.pushEvent({ type: "model.start", modelId: "mimo-2.5" })
store.pushEvent({ type: "model.delta", text: "I need to import the secret from config." })
store.pushEvent({ type: "model.done", finishReason: "stop" })
store.pushEvent({
  type: "engine.usage",
  delta: { promptTokens: 800, completionTokens: 120, totalTokens: 920 },
  total: { promptTokens: 4_320, completionTokens: 480, totalTokens: 4_800, callCount: 3, costUsd: 0.0214 },
})
store.pushEvent({
  type: "engine.done",
  reason: "model_done",
  usage: { promptTokens: 4_320, completionTokens: 480, totalTokens: 4_800, callCount: 3, costUsd: 0.0214 },
  durationMs: 8_400,
})

const modals = createModalQueue()
const toasts = createToastStore()

render(() => (
  <App
    store={store}
    cwd={process.cwd()}
    sessionId="demo-session-01H0000000000000000000"
    modals={modals}
    toasts={toasts}
    handlers={{
      onSubmit: (text) => {
        store.pushUser(text)
        store.pushSystem("(demo mode — no engine attached)", "dim")
      },
      onAbort: () => {
        store.pushSystem("aborted", "warn")
      },
      onQuit: () => {
        process.exit(0)
      },
    }}
  />
))
