import { theme } from "./theme.ts"
import type { StatusState } from "./state.ts"

/**
 * Landing — opencode pattern. Springs top and bottom, a small brand mark
 * and a few stats in the middle. Top-level props throughout.
 */
export function LandingScreen(props: { status: StatusState; cwd: string }) {
  return (
    <box flexGrow={1} flexDirection="column" paddingTop={1}>
      <box flexGrow={1} />
      <text fg={theme.primary}>◆</text>
      <text fg={theme.textMuted}>a self-improving agent harness for open models</text>
      <box height={1} />
      <Stat label="model" value={props.status.modelName} />
      <Stat label="cwd" value={shorten(props.cwd, 70)} />
      <box height={1} />
      <text fg={theme.textMuted}>
        type your request below, or <span style={{ fg: theme.text }}>/</span> for commands
      </text>
      <box flexGrow={1} />
    </box>
  )
}

function Stat(props: { label: string; value: string }) {
  return (
    <box flexDirection="row">
      <text fg={theme.textMuted}>{props.label.padEnd(8)}</text>
      <text fg={theme.text}>{props.value}</text>
    </box>
  )
}

function shorten(s: string, max: number): string {
  if (s.length <= max) return s
  return `…${s.slice(-(max - 1))}`
}
