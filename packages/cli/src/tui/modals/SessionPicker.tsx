import { For, Show, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Modal } from "./Modal.tsx"
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
    <Modal title="sessions" subtitle={`${props.spec.rows.length} total · current: ${shortId(props.spec.currentId)}`} width={92}>
      <Show when={props.spec.rows.length === 0} fallback={null}>
        <text fg="#64748b">  (no past sessions yet)</text>
      </Show>
      <box style={{ flexDirection: "column", maxHeight: 14 }}>
        <For each={props.spec.rows.slice(0, 14)}>
          {(row, i) => {
            const isSel = () => i() === selected()
            const isCurrent = row.id === props.spec.currentId
            return (
              <box
                style={{
                  flexDirection: "row",
                  backgroundColor: isSel() ? "#1e293b" : "transparent",
                  paddingLeft: 1,
                  paddingRight: 1,
                }}
              >
                <text fg={isSel() ? "#06b6d4" : "#475569"}>{isSel() ? "› " : "  "}</text>
                <text fg={isCurrent ? "#fbbf24" : "#cbd5e1"}>{shortId(row.id)}</text>
                <text fg="#475569">  {row.model.padEnd(20).slice(0, 20)}</text>
                <text fg={statusColor(row.status)}>  {row.status.padEnd(10)}</text>
                <text fg="#64748b">  {row.turns} turns</text>
                <text fg="#475569">  {formatRelative(row.updatedAt)}</text>
              </box>
            )
          }}
        </For>
      </box>
      <box style={{ height: 1 }} />
      <text fg="#475569">  ↑↓ navigate · ⏎ resume · [n] new session · esc cancel</text>
    </Modal>
  )
}

function shortId(id: string): string {
  return id.slice(-12)
}
function statusColor(s: string): string {
  if (s === "active") return "#10b981"
  if (s === "completed") return "#64748b"
  if (s === "aborted") return "#f59e0b"
  return "#94a3b8"
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
