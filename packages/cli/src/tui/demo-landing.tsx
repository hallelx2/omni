/**
 * Empty-state smoke test — renders only the landing screen.
 *
 *   bun packages/cli/src/tui/demo-landing.tsx
 */
import { render } from "@opentui/solid"
import { App } from "./App.tsx"
import { createTuiStore } from "./state.ts"
import { createModalQueue } from "./modals/index.ts"
import { createToastStore } from "./Toast.tsx"

const store = createTuiStore({ modelName: "mimo-2.5", mcpServers: 2 })
store.setProfile({ nativeTools: true, follows: true, verbose: false })

const modals = createModalQueue()
const toasts = createToastStore()

render(() => (
  <App
    store={store}
    cwd={process.cwd()}
    modals={modals}
    toasts={toasts}
    handlers={{
      onSubmit: (text) => store.pushUser(text),
      onAbort: () => {},
      onQuit: () => process.exit(0),
    }}
  />
))
