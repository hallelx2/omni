import type { JSX } from "@opentui/solid"

/**
 * Centred modal frame with backdrop. Renders absolute so it overlays
 * whatever's beneath. Specific modals (Permission, Question, ...) compose
 * their content inside.
 */
export function Modal(props: {
  title?: string
  subtitle?: string
  width?: number
  accent?: string
  children?: JSX.Element
}) {
  const accent = props.accent ?? "#06b6d4"
  return (
    <box
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        // semi-transparent backdrop effect via subtle bg
        backgroundColor: "rgba(0,0,0,0.55)",
      }}
    >
      <box
        style={{
          flexDirection: "column",
          width: props.width ?? 72,
          borderStyle: "rounded",
          borderColor: accent,
          backgroundColor: "#0b1220",
          paddingLeft: 2,
          paddingRight: 2,
          paddingTop: 1,
          paddingBottom: 1,
        }}
      >
        {props.title ? (
          <box style={{ flexDirection: "row" }}>
            <text fg={accent}>◆ </text>
            <text fg="#e2e8f0">{props.title}</text>
          </box>
        ) : null}
        {props.subtitle ? <text fg="#64748b">  {props.subtitle}</text> : null}
        <box style={{ height: 1 }} />
        {props.children}
      </box>
    </box>
  )
}
