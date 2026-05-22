import { Show } from "solid-js"
import { theme } from "./theme.ts"
import type { StatusState } from "./state.ts"

/**
 * Bottom status strip — opencode pattern. flex-row, space-between:
 * cwd on the left, connection / hint pills on the right.
 */
export function FooterStrip(props: {
  status: StatusState
  cwd: string
  running: boolean
  hasInput: boolean
}) {
  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0} paddingLeft={2} paddingRight={2}>
      <text fg={theme.textMuted}>{shorten(props.cwd, 60)}</text>
      <box flexDirection="row" gap={2} flexShrink={0}>
        <Show when={props.status.mcpServers > 0}>
          <text fg={theme.text}>
            <span style={{ fg: theme.success }}>⊙</span> {props.status.mcpServers} MCP
          </text>
        </Show>
        <Show when={props.running}>
          <text fg={theme.warning}>
            <span style={{ fg: theme.warning }}>●</span> iter {props.status.iter}/{props.status.maxIter}
          </text>
        </Show>
        <text fg={theme.text}>
          <span style={{ fg: theme.text }}>{props.running ? "esc" : props.hasInput ? "⏎" : "/"}</span>{" "}
          <span style={{ fg: theme.textMuted }}>
            {props.running ? "interrupt" : props.hasInput ? "send" : "commands"}
          </span>
        </text>
      </box>
    </box>
  )
}

function shorten(s: string, max: number): string {
  if (s.length <= max) return s
  return `…${s.slice(-(max - 1))}`
}
