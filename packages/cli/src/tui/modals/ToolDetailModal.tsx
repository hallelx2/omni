import { For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { Modal } from "./Modal.tsx"
import type { RGBA } from "@opentui/core"
import { theme } from "../theme.ts"
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
    <Modal title={`Tool · ${e.call.name}`} subtitle={`status: ${e.status}`} width="xlarge">
      <box paddingLeft={4} paddingRight={4} flexDirection="column">
        <text fg={theme.accent}>args</text>
        <text fg={theme.text}>  {tryStringify(e.call.args)}</text>
        <Show when={e.resultPreview}>
          <box height={1} />
          <text fg={theme.success}>result</text>
          <text fg={theme.text}>  {e.resultPreview}</text>
        </Show>
        <Show when={e.errorMessage}>
          <box height={1} />
          <text fg={theme.error}>error</text>
          <text fg={theme.error}>  {e.errorMessage}</text>
        </Show>
        <Show when={e.verifiers.length > 0}>
          <box height={1} />
          <text fg={theme.info}>verifiers</text>
          <For each={e.verifiers}>
            {(v) => <VerifierRow v={v} />}
          </For>
        </Show>
        <Show when={e.durationMs !== undefined}>
          <box height={1} />
          <text fg={theme.textMuted}>duration: {e.durationMs}ms</text>
        </Show>
      </box>
      <box height={1} />
      <box paddingLeft={4} paddingRight={4}>
        <text fg={theme.textMuted}>⏎ or esc to close</text>
      </box>
    </Modal>
  )
}

function VerifierRow(props: { v: VerifierEntry }) {
  return (
    <box flexDirection="column" paddingLeft={2}>
      <box flexDirection="row">
        <text fg={verifierColor(props.v.status)}>{verifierIcon(props.v.status)}</text>
        <text fg={theme.text}> {props.v.name}</text>
        <Show when={props.v.durationMs !== undefined}>
          <text fg={theme.textMuted}> · {props.v.durationMs}ms</text>
        </Show>
      </box>
      <Show when={props.v.reason}>
        <text fg={theme.textMuted}>    {props.v.reason}</text>
      </Show>
      <Show when={props.v.feedback}>
        <text fg={theme.textMuted}>    {props.v.feedback}</text>
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
    case "skip":    return "○"
  }
}
function verifierColor(s: VerifierEntry["status"]): RGBA {
  switch (s) {
    case "running": return theme.info
    case "pass":    return theme.success
    case "fail":    return theme.error
    case "skip":    return theme.textMuted
  }
}
