/**
 * Empty-state smoke test — renders only the landing screen.
 *
 *   bun packages/cli/src/tui/demo-landing.tsx
 */
import { render } from "@opentui/solid"
import { App } from "./App.tsx"
import { createTuiStore } from "./state.ts"

const store = createTuiStore({ modelName: "mimo-2.5", mcpServers: 2 })
store.setProfile({ nativeTools: true, follows: true, verbose: false })

render(() => (
  <App
    store={store}
    cwd={process.cwd()}
    handlers={{
      onSubmit: (text) => store.pushUser(text),
      onAbort: () => {},
      onQuit: () => process.exit(0),
    }}
  />
))
