import { Show, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { StatusBar } from "./StatusBar.tsx"
import { MessageList } from "./MessageList.tsx"
import { InputBox, SLASH_COMMANDS } from "./InputBox.tsx"
import { LandingScreen } from "./LandingScreen.tsx"
import { SlashPopup } from "./SlashPopup.tsx"
import { ModalLayer, type ModalQueue } from "./modals/index.ts"
import { ToastStrip, type ToastStore } from "./Toast.tsx"
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
 * Layout (top → bottom):
 *
 *   ┌─ StatusBar  (1 line: ◆ model · probe · skill · tokens · cost) ─┐
 *   │                                                                 │
 *   │  LandingScreen (when no messages)   OR   MessageList (scroll)   │
 *   │                                                                 │
 *   │  SlashPopup (overlay, only while input starts with "/")         │
 *   ├─ FooterHints (1 line, context-aware)                            │
 *   └─ InputBox    (3 lines, bordered)                                │
 *
 * App owns the input value + history so other components can read it
 * (SlashPopup filters on it; InputBox displays it). Engine wiring lives
 * in handlers passed in by the driver — App never imports @omni/core.
 */
export function App(props: {
  store: TuiStore
  handlers: AppHandlers
  cwd: string
  modals: ModalQueue
  toasts: ToastStore
}) {
  const [inputValue, setInputValue] = createSignal("")
  const [inputHistory, setInputHistory] = createSignal<readonly string[]>([])
  const showSlashPopup = () => inputValue().startsWith("/")
  const hasModal = () => props.modals.top() !== null

  useKeyboard((ev) => {
    // When a modal is open let it handle everything (it owns the keyboard).
    if (hasModal()) return
    if (ev.ctrl && ev.name === "c") {
      if (props.store.running()) props.handlers.onAbort()
      else props.handlers.onQuit()
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
    <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
      <StatusBar status={props.store.status()} running={props.store.running()} />

      <Show
        when={props.store.messages().length > 0}
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

      <FooterHints running={props.store.running()} hasInput={inputValue().length > 0} />

      <InputBox
        value={inputValue()}
        onChange={setInputValue}
        onSubmit={onSubmit}
        disabled={props.store.running()}
        unfocused={hasModal()}
      />

      {/* Overlays — drawn absolutely above everything else */}
      <ToastStrip toasts={props.toasts.toasts()} />
      <ModalLayer queue={props.modals} />
    </box>
  )
}

function FooterHints(props: { running: boolean; hasInput: boolean }) {
  return (
    <box
      style={{
        flexDirection: "row",
        height: 1,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <text fg="#475569">
        {props.running
          ? "● running  ·  ctrl-c to abort"
          : props.hasInput
            ? "⏎ send  ·  esc clear  ·  ctrl-c quit"
            : "⏎ send  ·  / for commands  ·  ctrl-c quit"}
      </text>
    </box>
  )
}
