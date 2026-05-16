import { theme } from "./theme.ts"
import type { StatusState } from "./state.ts"

/**
 * Landing — opencode pattern. A spring at the top, a small brand mark,
 * a tagline, then the rest flows into the prompt mounted below in App.
 * The prompt is the focal point — the landing is *deliberately quiet*.
 */
export function LandingScreen(props: { status: StatusState; cwd: string }) {
  return (
    <box
      style={{
        flexGrow: 1,
        flexDirection: "column",
        paddingTop: 2,
        paddingBottom: 2,
        paddingLeft: 1,
      }}
    >
      <box style={{ flexGrow: 1 }} />
      <text fg={theme.primary}>◆</text>
      <text fg={theme.textMuted}>a self-improving agent harness for open models</text>
      <box style={{ height: 1 }} />
      <Stat label="model" value={props.status.modelName} />
      <Stat label="cwd"   value={shorten(props.cwd, 70)} />
      <box style={{ height: 1 }} />
      <text fg={theme.textMuted}>
        type your request below, or <text fg={theme.text}>/</text>{" "}
        <text fg={theme.textMuted}>for commands</text>
      </text>
    </box>
  )
}

function Stat(props: { label: string; value: string }) {
  return (
    <box style={{ flexDirection: "row" }}>
      <text fg={theme.textMuted}>{props.label.padEnd(8)}</text>
      <text fg={theme.text}>{props.value}</text>
    </box>
  )
}

function shorten(s: string, max: number): string {
  if (s.length <= max) return s
  return `…${s.slice(-(max - 1))}`
}
