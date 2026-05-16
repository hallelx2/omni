import { Show, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Modal } from "./Modal.tsx"
import type { ConfirmModalSpec } from "./types.ts"

/**
 * Generic yes/no with focus toggleable via ←→ or tab. Default focus on
 * the confirm side unless `confirmByDefault === false`.
 */
export function ConfirmModal(props: { spec: ConfirmModalSpec }) {
  const [focusConfirm, setFocusConfirm] = createSignal(props.spec.confirmByDefault !== false)

  useKeyboard((ev) => {
    if (ev.name === "left" || ev.name === "right" || ev.name === "tab") {
      setFocusConfirm((b) => !b)
    } else if (ev.name === "return" || ev.name === "enter") {
      props.spec.resolve(focusConfirm())
    } else if (ev.name === "y") {
      props.spec.resolve(true)
    } else if (ev.name === "n" || ev.name === "escape") {
      props.spec.resolve(false)
    }
  })

  const confirmLabel = props.spec.confirmLabel ?? "yes"
  const cancelLabel = props.spec.cancelLabel ?? "no"

  return (
    <Modal title={props.spec.title} width={64}>
      <Show when={props.spec.body}>
        <text fg="#94a3b8">  {props.spec.body}</text>
      </Show>
      <box style={{ height: 1 }} />
      <box style={{ flexDirection: "row", paddingLeft: 2 }}>
        <ChoiceButton label={confirmLabel} focused={focusConfirm()} accent="#10b981" />
        <box style={{ width: 2 }} />
        <ChoiceButton label={cancelLabel} focused={!focusConfirm()} accent="#ef4444" />
      </box>
      <box style={{ height: 1 }} />
      <text fg="#475569">  ←→ toggle · ⏎ confirm · y/n shortcuts · esc cancels</text>
    </Modal>
  )
}

function ChoiceButton(props: { label: string; focused: boolean; accent: string }) {
  return (
    <box
      style={{
        paddingLeft: 2,
        paddingRight: 2,
        borderStyle: "rounded",
        borderColor: props.focused ? props.accent : "#334155",
      }}
    >
      <text fg={props.focused ? props.accent : "#475569"}>{props.label}</text>
    </box>
  )
}
