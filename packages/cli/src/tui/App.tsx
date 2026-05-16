import { Show, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { MessageList } from "./MessageList.tsx"
import { InputBox, SLASH_COMMANDS } from "./InputBox.tsx"
import { LandingScreen } from "./LandingScreen.tsx"
import { SlashPopup } from "./SlashPopup.tsx"
import { Sidebar } from "./Sidebar.tsx"
import { FooterStrip } from "./FooterStrip.tsx"
import { ModalLayer, type ModalQueue } from "./modals/index.ts"
import { ToastStrip, type ToastStore } from "./Toast.tsx"
import { theme } from "./theme.ts"
import type { TuiStore } from "./state.ts"

export interface AppHandlers {
  /** User submitted text. Implementer drives engine/commands and pushes events into the store. */
  onSubmit: (text: string) => void | Promise<void>
  /** User aborted (ctrl-c during a run). */
  onAbort: () => void
  /** User quit (ctrl-c when idle). */
  onQuit: () => void
}

/**
 * Layout (opencode-style):
 *
 *   ┌──────────────────────────────┬──────────────┐
 *   │                              │              │
 *   │   MessageList (scrollbox)    │   Sidebar    │
 *   │   OR LandingScreen           │   (panel)    │
 *   │                              │              │
 *   │                              │              │
 *   │   SlashPopup (overlay above) │              │
 *   ├──────────────────────────────┤              │
 *   │   InputBox                   │              │
 *   ├──────────────────────────────┴──────────────┤
 *   │   FooterStrip (cwd · pills · hint)          │
 *   └─────────────────────────────────────────────┘
 *
 * No top status bar. The sidebar carries model/profile/cost; the footer
 * carries cwd + connection state. Background is the root color; the
 * sidebar gets `theme.backgroundPanel` for contrast.
 */
export function App(props: {
  store: TuiStore
  handlers: AppHandlers
  cwd: string
  sessionId: string
  modals: ModalQueue
  toasts: ToastStore
}) {
  const [inputValue, setInputValue] = createSignal("")
  const [inputHistory, setInputHistory] = createSignal<readonly string[]>([])
  const [sidebarOpen, setSidebarOpen] = createSignal(true)
  const showSlashPopup = () => inputValue().startsWith("/")
  const hasModal = () => props.modals.top() !== null
  const hasMessages = () => props.store.messages().length > 0

  useKeyboard((ev) => {
    if (hasModal()) return
    if (ev.ctrl && ev.name === "c") {
      if (props.store.running()) props.handlers.onAbort()
      else props.handlers.onQuit()
      return
    }
    if (ev.ctrl && ev.name === "b") {
      setSidebarOpen((b) => !b)
      return
    }
    if (ev.name === "escape" && showSlashPopup()) {
      setInputValue("")
    }
  })

  const onSubmit = (text: string) => {
    setInputHistory((h) => [...h, text].slice(-100))
    setInputValue("")
    void props.handlers.onSubmit(text)
  }

  const onSlashComplete = (name: string) => {
    setInputValue(`/${name} `)
  }

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        flexDirection: "column",
        backgroundColor: theme.background,
      }}
    >
      {/* Main row: chat area on the left, sidebar on the right */}
      <box style={{ flexDirection: "row", flexGrow: 1 }}>
        <box style={{ flexDirection: "column", flexGrow: 1, paddingLeft: 2, paddingRight: 2 }}>
          <Show when={hasMessages()} fallback={
            <LandingScreen status={props.store.status()} cwd={props.cwd} />
          }>
            <MessageList messages={props.store.messages()} />
          </Show>

          {/* Slash popup floats above the input */}
          <Show when={showSlashPopup() && !hasModal()}>
            <SlashPopup
              query={inputValue()}
              commands={SLASH_COMMANDS}
              onComplete={onSlashComplete}
            />
          </Show>

          <InputBox
            value={inputValue()}
            onChange={setInputValue}
            onSubmit={onSubmit}
            disabled={props.store.running()}
            unfocused={hasModal()}
            running={props.store.running()}
            modelName={props.store.status().modelName}
          />
        </box>

        <Show when={sidebarOpen()}>
          <Sidebar
            status={props.store.status()}
            cwd={props.cwd}
            sessionId={props.sessionId}
          />
        </Show>
      </box>

      <FooterStrip
        status={props.store.status()}
        cwd={props.cwd}
        running={props.store.running()}
        hasInput={inputValue().length > 0}
      />

      <ToastStrip toasts={props.toasts.toasts()} />
      <ModalLayer queue={props.modals} />
    </box>
  )
}
