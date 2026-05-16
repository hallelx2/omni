import { For, Show, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Modal } from "./Modal.tsx"
import { theme, selectedFg } from "../theme.ts"
import type { QuestionModalSpec } from "./types.ts"

/**
 * Agent-initiated question. The agent picks options; the user picks one
 * via key shortcut or arrow-nav + ⏎. If `allowOther` is set (default
 * true), pressing `o` switches to free-text entry.
 */
export function AskQuestionModal(props: { spec: QuestionModalSpec }) {
  const allowOther = props.spec.allowOther !== false
  const [selected, setSelected] = createSignal(0)
  const [otherMode, setOtherMode] = createSignal(false)
  const [otherValue, setOtherValue] = createSignal("")

  useKeyboard((ev) => {
    if (otherMode()) {
      if (ev.name === "escape") {
        setOtherMode(false)
        setOtherValue("")
      } else if ((ev.name === "return" || ev.name === "enter") && otherValue().trim().length > 0) {
        props.spec.resolve(otherValue().trim())
      }
      return
    }
    if (ev.name === "escape") {
      props.spec.resolve(null)
      return
    }
    if (ev.name === "up") setSelected((i) => (i === 0 ? props.spec.options.length - 1 : i - 1))
    else if (ev.name === "down") setSelected((i) => (i === props.spec.options.length - 1 ? 0 : i + 1))
    else if (ev.name === "return" || ev.name === "enter") {
      props.spec.resolve(props.spec.options[selected()]!.value)
    } else if (allowOther && ev.name === "o") {
      setOtherMode(true)
    } else {
      // single-char shortcut
      const ch = (ev as { name?: string }).name ?? ""
      const match = props.spec.options.find((o) => o.key === ch)
      if (match) props.spec.resolve(match.value)
    }
  })

  return (
    <Modal title="Question from agent" width="large">
      <box style={{ paddingLeft: 4, paddingRight: 4 }}>
        <text fg={theme.text}>{props.spec.question}</text>
        <Show when={props.spec.context}>
          <text fg={theme.textMuted}>{props.spec.context}</text>
        </Show>
      </box>
      <box style={{ height: 1 }} />
      <Show
        when={!otherMode()}
        fallback={
          <box style={{ paddingLeft: 4, paddingRight: 4 }}>
            <text fg={theme.textMuted}>type your answer · ⏎ submit · esc to go back</text>
            <FreeTextInput value={otherValue()} onChange={setOtherValue} />
          </box>
        }
      >
        <box style={{ flexDirection: "column" }}>
          <For each={props.spec.options}>
            {(opt, i) => {
              const isSel = () => i() === selected()
              const fg = () => (isSel() ? selectedFg(theme.primary) : theme.text)
              const muted = () => (isSel() ? selectedFg(theme.primary) : theme.textMuted)
              return (
                <box
                  style={{
                    flexDirection: "column",
                    paddingLeft: 4,
                    paddingRight: 4,
                    backgroundColor: isSel() ? theme.primary : "transparent",
                  }}
                >
                  <box style={{ flexDirection: "row" }}>
                    <text fg={muted()}>{opt.key}</text>
                    <text fg={fg()}>  {opt.label}</text>
                  </box>
                  <Show when={isSel() && opt.description}>
                    <text fg={muted()}>     {opt.description}</text>
                  </Show>
                </box>
              )
            }}
          </For>
          <Show when={allowOther}>
            <box style={{ flexDirection: "row", paddingLeft: 4, paddingTop: 1 }}>
              <text fg={theme.textMuted}>o</text>
              <text fg={theme.textMuted}>  other (type your own)</text>
            </box>
          </Show>
        </box>
      </Show>
      <box style={{ height: 1 }} />
      <box style={{ paddingLeft: 4, paddingRight: 4 }}>
        <text fg={theme.textMuted}>
          {otherMode()
            ? "⏎ submit · esc go back"
            : `↑↓ navigate · [key] shortcut · ⏎ choose · ${allowOther ? "[o] other · " : ""}esc cancel`}
        </text>
      </box>
    </Modal>
  )
}

function FreeTextInput(props: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={props.value}
      placeholder="type your answer…"
      focused
      onInput={props.onChange}
      onSubmit={(() => {}) as never}
    />
  )
}
