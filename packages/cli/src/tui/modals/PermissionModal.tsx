import { useKeyboard } from "@opentui/solid"
import { Modal } from "./Modal.tsx"
import type { PermissionDecision, PermissionModalSpec } from "./types.ts"

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

  const accent = props.spec.risk ? "#f59e0b" : "#06b6d4"

  return (
    <Modal
      title={`permission · ${props.spec.toolName}`}
      subtitle={props.spec.toolDescription}
      accent={accent}
      width={84}
    >
      <box style={{ flexDirection: "column", paddingLeft: 2 }}>
        <text fg="#64748b">args</text>
        <text fg="#cbd5e1">  {props.spec.argsPreview}</text>
        {props.spec.risk ? (
          <>
            <box style={{ height: 1 }} />
            <box style={{ flexDirection: "row" }}>
              <text fg="#f59e0b">⚠ </text>
              <text fg="#fbbf24">{props.spec.risk}</text>
            </box>
          </>
        ) : null}
      </box>
      <box style={{ height: 1 }} />
      <Choices
        items={[
          { key: "y", label: "allow once",   value: "allow" as const,        accent: "#10b981" },
          { key: "a", label: "allow always", value: "allow-always" as const, accent: "#34d399" },
          { key: "n", label: "deny",         value: "deny" as const,         accent: "#ef4444" },
          { key: "d", label: "deny always",  value: "deny-always" as const,  accent: "#dc2626" },
        ]}
      />
      <box style={{ height: 1 }} />
      <text fg="#475569">  ⏎ allow once · esc to deny</text>
    </Modal>
  )
}

function Choices(props: {
  items: ReadonlyArray<{ key: string; label: string; value: PermissionDecision; accent: string }>
}) {
  return (
    <box style={{ flexDirection: "row", paddingLeft: 2 }}>
      {props.items.map((it, i) => (
        <>
          <box
            style={{
              flexDirection: "row",
              paddingLeft: 1,
              paddingRight: 1,
              borderStyle: "rounded",
              borderColor: it.accent,
              marginRight: 1,
            }}
          >
            <text fg={it.accent}>[{it.key}]</text>
            <text fg="#e2e8f0"> {it.label}</text>
          </box>
          {i < props.items.length - 1 ? null : null}
        </>
      ))}
    </box>
  )
}
