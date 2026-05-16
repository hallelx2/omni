import type { JSX } from "@opentui/solid"
import { theme } from "../theme.ts"

/**
 * Centred modal — opencode pattern. Scrim 150-alpha, body is a plain
 * panel-colored rectangle (no borders, no rounded corners), title in
 * bold-bright with a clickable "esc" hint on the right. Body widths:
 * 60 / 88 / 116 cols.
 */
export function Modal(props: {
  title?: string
  subtitle?: string
  width?: "medium" | "large" | "xlarge" | number
  children?: JSX.Element
}) {
  const w =
    typeof props.width === "number"
      ? props.width
      : props.width === "xlarge"
        ? 116
        : props.width === "large"
          ? 88
          : 60
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
        // Dialogs hang from ~25% down the screen, opencode-style.
        paddingTop: 4,
        backgroundColor: "rgba(0,0,0,0.6)",
      }}
    >
      <box
        style={{
          flexDirection: "column",
          width: w,
          backgroundColor: theme.backgroundPanel,
          paddingTop: 1,
          paddingBottom: 1,
        }}
      >
        {props.title ? (
          <box style={{ flexDirection: "row", paddingLeft: 4, paddingRight: 4 }}>
            <text fg={theme.text}>{props.title}</text>
            <box style={{ flexGrow: 1 }} />
            <text fg={theme.textMuted}>esc</text>
          </box>
        ) : null}
        {props.subtitle ? (
          <box style={{ paddingLeft: 4, paddingRight: 4 }}>
            <text fg={theme.textMuted}>{props.subtitle}</text>
          </box>
        ) : null}
        <box style={{ height: 1 }} />
        {props.children}
      </box>
    </box>
  )
}
