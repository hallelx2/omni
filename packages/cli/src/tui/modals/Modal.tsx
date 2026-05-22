import type { JSX } from "@opentui/solid"
import { useTerminalDimensions } from "@opentui/solid"
import { theme } from "../theme.ts"

/**
 * Centred modal — opencode pattern. Absolute full-screen scrim, body is
 * a panel-colored rectangle (no borders), title bold-bright left + muted
 * "esc" right. Hangs ~25% down the screen. Top-level props throughout.
 */
export function Modal(props: {
  title?: string
  subtitle?: string
  width?: "medium" | "large" | "xlarge" | number
  children?: JSX.Element
}) {
  const dimensions = useTerminalDimensions()
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
      position="absolute"
      top={0}
      left={0}
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      alignItems="center"
      paddingTop={Math.floor(dimensions().height / 4)}
      backgroundColor="rgba(0,0,0,0.6)"
      zIndex={3000}
    >
      <box
        flexDirection="column"
        width={Math.min(w, dimensions().width - 2)}
        backgroundColor={theme.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
      >
        {props.title ? (
          <box flexDirection="row" paddingLeft={4} paddingRight={4}>
            <text fg={theme.text}>{props.title}</text>
            <box flexGrow={1} />
            <text fg={theme.textMuted}>esc</text>
          </box>
        ) : null}
        {props.subtitle ? (
          <box paddingLeft={4} paddingRight={4}>
            <text fg={theme.textMuted}>{props.subtitle}</text>
          </box>
        ) : null}
        <box height={1} />
        {props.children}
      </box>
    </box>
  )
}
