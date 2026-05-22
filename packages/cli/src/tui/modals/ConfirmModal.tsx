import { Show, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Modal } from "./Modal.tsx"
import { theme, selectedFg } from "../theme.ts"
import type { ConfirmModalSpec } from "./types.ts"

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
    <Modal title={props.spec.title} width="medium">
      <Show when={props.spec.body}>
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.textMuted}>{props.spec.body}</text>
        </box>
      </Show>
      <box height={1} />
      <box flexDirection="row" paddingLeft={4} paddingRight={4}>
        <Slab label={confirmLabel} focused={focusConfirm()} />
        <text fg={theme.textMuted}>  </text>
        <Slab label={cancelLabel} focused={!focusConfirm()} />
      </box>
      <box height={1} />
      <box paddingLeft={4} paddingRight={4}>
        <text fg={theme.textMuted}>←→ toggle · ⏎ confirm · y/n shortcuts · esc cancels</text>
      </box>
    </Modal>
  )
}

function Slab(props: { label: string; focused: boolean }) {
  return (
    <box paddingLeft={2} paddingRight={2} backgroundColor={props.focused ? theme.primary : theme.backgroundElement}>
      <text fg={props.focused ? selectedFg(theme.primary) : theme.text}>{props.label}</text>
    </box>
  )
}
