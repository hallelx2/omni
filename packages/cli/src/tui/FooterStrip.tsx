import { Show } from "solid-js"
import { theme } from "./theme.ts"
import type { StatusState } from "./state.ts"

/**
 * Bottom status strip — opencode's `routes/session/footer.tsx`. flex-row,
 * space-between: working directory on the left; connection signals (skill,
 * MCP) and a `/help` affordance on the right, in opencode's exact glyph
 * idiom (⊙ for MCP, • for an active signal).
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
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Show when={props.status.mode === "plan"}>
          <text fg={theme.warning}>
            <span style={{ fg: theme.warning }}>◐</span> plan
          </text>
        </Show>
        <Show when={props.status.skillName}>
          <text fg={theme.text}>
            <span style={{ fg: theme.accent }}>◆</span> {props.status.skillName}
          </text>
        </Show>
        <Show when={props.status.mcpServers > 0}>
          <text fg={theme.text}>
            <span style={{ fg: theme.success }}>⊙</span> {props.status.mcpServers} MCP
          </text>
        </Show>
        <text fg={theme.textMuted}>/help</text>
      </box>
    </box>
  )
}

function shorten(s: string, max: number): string {
  if (s.length <= max) return s
  return `…${s.slice(-(max - 1))}`
}
