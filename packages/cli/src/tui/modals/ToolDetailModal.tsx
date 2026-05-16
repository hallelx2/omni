import { For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Modal } from "./Modal.tsx"
import type { ModalCommon } from "./types.ts"
import type { MessageEntry, VerifierEntry } from "../state.ts"

export interface ToolDetailModalSpec extends ModalCommon<void> {
  readonly kind: "tool-detail"
  readonly entry: Extract<MessageEntry, { kind: "tool" }>
}

/**
 * Read-only inspection of a single tool call. Shows full args + result
 * (truncation off), plus the verifier strip. ⏎ or esc to close.
 */
export function ToolDetailModal(props: { spec: ToolDetailModalSpec }) {
  useKeyboard((ev) => {
    if (ev.name === "escape" || ev.name === "return" || ev.name === "enter" || ev.name === "q") {
      props.spec.resolve()
    }
  })

  const e = props.spec.entry
  return (
    <Modal title={`tool · ${e.call.name}`} subtitle={`status: ${e.status}`} width={92}>
      <box style={{ paddingLeft: 2, flexDirection: "column" }}>
        <text fg="#a78bfa">args</text>
        <text fg="#cbd5e1">  {tryStringify(e.call.args)}</text>
        <Show when={e.resultPreview}>
          <box style={{ height: 1 }} />
          <text fg="#10b981">result</text>
          <text fg="#cbd5e1">  {e.resultPreview}</text>
        </Show>
        <Show when={e.errorMessage}>
          <box style={{ height: 1 }} />
          <text fg="#ef4444">error</text>
          <text fg="#fca5a5">  {e.errorMessage}</text>
        </Show>
        <Show when={e.verifiers.length > 0}>
          <box style={{ height: 1 }} />
          <text fg="#06b6d4">verifiers</text>
          <For each={e.verifiers}>
            {(v) => <VerifierRow v={v} />}
          </For>
        </Show>
        <Show when={e.durationMs !== undefined}>
          <box style={{ height: 1 }} />
          <text fg="#64748b">  duration: {e.durationMs}ms</text>
        </Show>
      </box>
      <box style={{ height: 1 }} />
      <text fg="#475569">  ⏎ or esc to close</text>
    </Modal>
  )
}

function VerifierRow(props: { v: VerifierEntry }) {
  return (
    <box style={{ flexDirection: "column", paddingLeft: 2 }}>
      <box style={{ flexDirection: "row" }}>
        <text fg={verifierColor(props.v.status)}>{verifierIcon(props.v.status)}</text>
        <text fg="#cbd5e1"> {props.v.name}</text>
        <Show when={props.v.durationMs !== undefined}>
          <text fg="#334155"> · {props.v.durationMs}ms</text>
        </Show>
      </box>
      <Show when={props.v.reason}>
        <text fg="#94a3b8">    {props.v.reason}</text>
      </Show>
      <Show when={props.v.feedback}>
        <text fg="#64748b">    {props.v.feedback}</text>
      </Show>
    </box>
  )
}

function tryStringify(v: unknown): string {
  if (typeof v === "string") return v
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

function verifierIcon(s: VerifierEntry["status"]): string {
  switch (s) {
    case "running": return "…"
    case "pass":    return "✓"
    case "fail":    return "✗"
    case "skip":    return "◌"
  }
}
function verifierColor(s: VerifierEntry["status"]): string {
  switch (s) {
    case "running": return "#06b6d4"
    case "pass":    return "#10b981"
    case "fail":    return "#ef4444"
    case "skip":    return "#64748b"
  }
}
