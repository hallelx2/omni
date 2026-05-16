import { For, Show, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Modal } from "./Modal.tsx"
import { theme, selectedFg } from "../theme.ts"
import type { SessionPickerModalSpec } from "./types.ts"

/**
 * Past-session picker. ↑↓ navigates, ⏎ resumes the highlighted session,
 * `n` opens a new one (resolves with the special value "@new"), esc cancels.
 */
export function SessionPicker(props: { spec: SessionPickerModalSpec }) {
  const [selected, setSelected] = createSignal(0)

  useKeyboard((ev) => {
    if (ev.name === "escape") return props.spec.resolve(null)
    if (ev.name === "n") return props.spec.resolve("@new")
    if (ev.name === "up") setSelected((i) => (i === 0 ? props.spec.rows.length - 1 : i - 1))
    else if (ev.name === "down") setSelected((i) => (i === props.spec.rows.length - 1 ? 0 : i + 1))
    else if (ev.name === "return" || ev.name === "enter") {
      const r = props.spec.rows[selected()]
      if (r) props.spec.resolve(r.id)
    }
  })

  return (
    <Modal
      title="Sessions"
      subtitle={`${props.spec.rows.length} total · current ${shortId(props.spec.currentId)}`}
      width="xlarge"
    >
      <Show when={props.spec.rows.length === 0}>
        <box style={{ paddingLeft: 4, paddingRight: 4 }}>
          <text fg={theme.textMuted}>(no past sessions yet)</text>
        </box>
      </Show>
      <box style={{ flexDirection: "column", maxHeight: 14 }}>
        <For each={props.spec.rows.slice(0, 14)}>
          {(row, i) => {
            const isSel = () => i() === selected()
            const fg = () => (isSel() ? selectedFg(theme.primary) : theme.text)
            const muted = () => (isSel() ? selectedFg(theme.primary) : theme.textMuted)
            return (
              <box
                style={{
                  flexDirection: "row",
                  paddingLeft: 4,
                  paddingRight: 4,
                  backgroundColor: isSel() ? theme.primary : "transparent",
                }}
              >
                <text fg={fg()}>{shortId(row.id)}</text>
                <text fg={muted()}>  {row.model.padEnd(20).slice(0, 20)}</text>
                <text fg={statusColor(row.status, isSel())}>  {row.status.padEnd(10)}</text>
                <text fg={muted()}>  {row.turns} turns</text>
                <text fg={muted()}>  {formatRelative(row.updatedAt)}</text>
              </box>
            )
          }}
        </For>
      </box>
      <box style={{ height: 1 }} />
      <box style={{ paddingLeft: 4, paddingRight: 4 }}>
        <text fg={theme.textMuted}>↑↓ navigate · ⏎ resume · n new session · esc cancel</text>
      </box>
    </Modal>
  )
}

function shortId(id: string): string {
  return id.slice(-12)
}
function statusColor(s: string, selected: boolean): string {
  if (selected) return selectedFg(theme.primary)
  if (s === "active") return theme.success
  if (s === "completed") return theme.textMuted
  if (s === "aborted") return theme.warning
  return theme.text
}
function formatRelative(t: number): string {
  const diff = Date.now() - t
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}
