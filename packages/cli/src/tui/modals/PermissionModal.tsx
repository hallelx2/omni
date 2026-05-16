import { useKeyboard } from "@opentui/solid"
import { Modal } from "./Modal.tsx"
import { theme } from "../theme.ts"
import type { PermissionModalSpec } from "./types.ts"

/**
 * Permission prompt. Tool-grounded keys:
 *   y / ⏎  → allow once
 *   a      → allow always (this tool, this session)
 *   n / esc → deny once
 *   d      → deny always
 */
export function PermissionModal(props: { spec: PermissionModalSpec }) {
  useKeyboard((ev) => {
    if (ev.name === "y" || ev.name === "return" || ev.name === "enter") {
      props.spec.resolve("allow")
    } else if (ev.name === "a") {
      props.spec.resolve("allow-always")
    } else if (ev.name === "n" || ev.name === "escape") {
      props.spec.resolve("deny")
    } else if (ev.name === "d") {
      props.spec.resolve("deny-always")
    }
  })

  return (
    <Modal title={`Permission · ${props.spec.toolName}`} subtitle={props.spec.toolDescription} width="large">
      <box style={{ paddingLeft: 4, paddingRight: 4 }}>
        <text fg={theme.textMuted}>args</text>
        <text fg={theme.text}>  {props.spec.argsPreview}</text>
        {props.spec.risk ? (
          <>
            <box style={{ height: 1 }} />
            <box style={{ flexDirection: "row" }}>
              <text fg={theme.warning}>△ </text>
              <text fg={theme.warning}>{props.spec.risk}</text>
            </box>
          </>
        ) : null}
      </box>
      <box style={{ height: 1 }} />
      <box style={{ flexDirection: "row", paddingLeft: 4, paddingRight: 4 }}>
        <KeyLabel k="y" label="allow once" tone={theme.success} />
        <Sep />
        <KeyLabel k="a" label="allow always" tone={theme.success} />
        <Sep />
        <KeyLabel k="n" label="deny" tone={theme.error} />
        <Sep />
        <KeyLabel k="d" label="deny always" tone={theme.error} />
      </box>
      <box style={{ height: 1 }} />
      <box style={{ paddingLeft: 4, paddingRight: 4 }}>
        <text fg={theme.textMuted}>⏎ allow once · esc to deny</text>
      </box>
    </Modal>
  )
}

function KeyLabel(props: { k: string; label: string; tone: string }) {
  return (
    <box style={{ flexDirection: "row" }}>
      <text fg={props.tone}>{props.k}</text>
      <text fg={theme.textMuted}> {props.label}</text>
    </box>
  )
}
function Sep() { return <text fg={theme.textMuted}>   ·   </text> }
