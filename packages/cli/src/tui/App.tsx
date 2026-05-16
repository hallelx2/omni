import { createSignal, onCleanup } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { StatusBar } from "./StatusBar.tsx"
import { MessageList } from "./MessageList.tsx"
import { InputBox } from "./InputBox.tsx"
import type { TuiStore } from "./state.ts"

export interface AppHandlers {
  /** User submitted text. Implementer drives engine/commands and pushes events into the store. */
  onSubmit: (text: string) => void | Promise<void>
  /** User aborted (ctrl-c during a run). */
  onAbort: () => void
  /** User quit (ctrl-c when idle, or /quit). */
  onQuit: () => void
}

/**
 * The whole TUI in one frame:
 *
 *   ┌──── status bar (1 line, model + pills + tokens) ────┐
 *   ├──── message log (flex-grow scrollbox) ──────────────┤
 *   ├──── footer hints (1 line) ─────────────────────────┤
 *   └──── input box (textarea, 3-6 lines) ───────────────┘
 *
 * App doesn't own engine state — it reads from the store passed in. That
 * keeps the driver code in bin.tui.ts free to swap implementations
 * (real engine, replay, demo) without rewriting components.
 */
export function App(props: { store: TuiStore; handlers: AppHandlers }) {
  const [inputHistory, setInputHistory] = createSignal<readonly string[]>([])

  useKeyboard((ev) => {
    if (ev.ctrl && ev.name === "c") {
      if (props.store.running()) props.handlers.onAbort()
      else props.handlers.onQuit()
    }
  })

  onCleanup(() => {
    // Nothing to clean up here — the driver flushes traces/store/MCP elsewhere.
  })

  const onSubmit = (text: string) => {
    setInputHistory((h) => [...h, text].slice(-100))
    props.handlers.onSubmit(text)
  }

  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
      <StatusBar status={props.store.status()} running={props.store.running()} />

      <MessageList messages={props.store.messages()} />

      <FooterHints running={props.store.running()} />

      <InputBox
        onSubmit={onSubmit}
        disabled={props.store.running()}
        history={inputHistory()}
      />
    </box>
  )
}

function FooterHints(props: { running: boolean }) {
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
          ? "● running   ctrl-c abort"
          : "⏎ send · ↑↓ history · / commands · ctrl-c quit"}
      </text>
    </box>
  )
}
