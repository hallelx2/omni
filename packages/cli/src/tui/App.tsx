import { Show, createSignal } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
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
  onSubmit: (text: string) => void | Promise<void>
  onAbort: () => void
  onQuit: () => void
}

/**
 * Root — opencode pattern. Explicit terminal dimensions on the root box
 * (not flexGrow / "100%"), top-level box props everywhere (no `style`
 * objects), and the layout:
 *
 *   root (column, full terminal)
 *   ├─ body (row, flexGrow 1, minHeight 0)
 *   │   ├─ chat column (flexGrow 1)
 *   │   │   ├─ MessageList / LandingScreen (flexGrow 1)
 *   │   │   ├─ SlashPopup (when typing /)
 *   │   │   └─ InputBox
 *   │   └─ Sidebar (width 42)
 *   └─ FooterStrip (flexShrink 0)
 */
export function App(props: {
  store: TuiStore
  handlers: AppHandlers
  cwd: string
  sessionId: string
  modals: ModalQueue
  toasts: ToastStore
}) {
  const dimensions = useTerminalDimensions()
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
  const onSlashComplete = (name: string) => setInputValue(`/${name} `)

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background}
    >
      <box flexGrow={1} minHeight={0} flexDirection="row">
        <box flexGrow={1} minHeight={0} flexDirection="column" paddingLeft={2} paddingRight={2}>
          <Show
            when={hasMessages()}
            fallback={<LandingScreen status={props.store.status()} cwd={props.cwd} />}
          >
            <MessageList messages={props.store.messages()} />
          </Show>

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

      <box flexShrink={0}>
        <FooterStrip
          status={props.store.status()}
          cwd={props.cwd}
          running={props.store.running()}
          hasInput={inputValue().length > 0}
        />
      </box>

      <ToastStrip toasts={props.toasts.toasts()} />
      <ModalLayer queue={props.modals} />
    </box>
  )
}
