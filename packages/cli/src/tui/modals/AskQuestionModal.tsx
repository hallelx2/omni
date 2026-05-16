import { For, Show, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Modal } from "./Modal.tsx"
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
    <Modal title="agent question" accent="#a78bfa" width={84}>
      <box style={{ paddingLeft: 2 }}>
        <text fg="#e2e8f0">{props.spec.question}</text>
        <Show when={props.spec.context}>
          <text fg="#64748b">  {props.spec.context}</text>
        </Show>
      </box>
      <box style={{ height: 1 }} />
      <Show
        when={!otherMode()}
        fallback={
          <box style={{ paddingLeft: 2 }}>
            <text fg="#94a3b8">type your answer · ⏎ submit · esc to go back</text>
            <text fg="#a78bfa">  › {otherValue() || " "}</text>
            <FreeTextInput value={otherValue()} onChange={setOtherValue} />
          </box>
        }
      >
        <box style={{ flexDirection: "column", paddingLeft: 2 }}>
          <For each={props.spec.options}>
            {(opt, i) => {
              const isSel = () => i() === selected()
              return (
                <box
                  style={{
                    flexDirection: "column",
                    backgroundColor: isSel() ? "#1e293b" : "transparent",
                    paddingLeft: 1,
                    paddingRight: 1,
                  }}
                >
                  <box style={{ flexDirection: "row" }}>
                    <text fg={isSel() ? "#a78bfa" : "#64748b"}>
                      {isSel() ? "› " : "  "}
                    </text>
                    <text fg="#475569">[{opt.key}]</text>
                    <text fg={isSel() ? "#e2e8f0" : "#cbd5e1"}> {opt.label}</text>
                  </box>
                  <Show when={isSel() && opt.description}>
                    <text fg="#64748b">      {opt.description}</text>
                  </Show>
                </box>
              )
            }}
          </For>
          <Show when={allowOther}>
            <box style={{ flexDirection: "row", paddingLeft: 1, paddingTop: 1 }}>
              <text fg="#64748b">  [o] </text>
              <text fg="#64748b">other (type your own)</text>
            </box>
          </Show>
        </box>
      </Show>
      <box style={{ height: 1 }} />
      <text fg="#475569">
        {otherMode()
          ? "  ⏎ submit · esc go back"
          : `  ↑↓ navigate · [key] shortcut · ⏎ choose · ${allowOther ? "[o] other · " : ""}esc cancel`}
      </text>
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
