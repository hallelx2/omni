import { Show } from "solid-js"
import { theme } from "./theme.ts"
import type { StatusState } from "./state.ts"

/**
 * Bottom-of-screen status strip (opencode pattern). Two columns,
 * space-between: cwd on the left, connection / hint pills on the right.
 * One line tall. The actual page chrome is everywhere else.
 */
export function FooterStrip(props: {
  status: StatusState
  cwd: string
  running: boolean
  hasInput: boolean
}) {
  return (
    <box
      style={{
        flexDirection: "row",
        height: 1,
        paddingLeft: 2,
        paddingRight: 2,
      }}
    >
      <text fg={theme.textMuted}>{shorten(props.cwd, 60)}</text>
      <box style={{ flexGrow: 1 }} />

      <Show when={props.status.mcpServers > 0}>
        <Pill icon="⊙" label={`${props.status.mcpServers} MCP`} tone={theme.success} />
        <text fg={theme.textMuted}>  </text>
      </Show>
      <Show when={props.running}>
        <Pill icon="●" label={`iter ${props.status.iter}/${props.status.maxIter}`} tone={theme.warning} />
        <text fg={theme.textMuted}>  </text>
      </Show>

      <text fg={theme.text}>
        {props.running ? "esc " : props.hasInput ? "⏎ " : "/ "}
      </text>
      <text fg={theme.textMuted}>
        {props.running ? "interrupt" : props.hasInput ? "send" : "commands"}
      </text>
    </box>
  )
}

function Pill(props: { icon: string; label: string; tone: string }) {
  return (
    <box style={{ flexDirection: "row" }}>
      <text fg={props.tone}>{props.icon} </text>
      <text fg={theme.textMuted}>{props.label}</text>
    </box>
  )
}

function shorten(s: string, max: number): string {
  if (s.length <= max) return s
  return `…${s.slice(-(max - 1))}`
}
