import { For } from "solid-js"
import { theme } from "./theme.ts"
import type { StatusState } from "./state.ts"

/**
 * Landing block — just the centred logo, tagline and a couple of stats.
 * The App centres this together with the prompt (ChatGPT-style) when the
 * transcript is empty, so this carries no flex springs of its own.
 */

const LOGO = [
  " ██████╗ ███╗   ███╗███╗   ██╗██╗",
  "██╔═══██╗████╗ ████║████╗  ██║██║",
  "██║   ██║██╔████╔██║██╔██╗ ██║██║",
  "██║   ██║██║╚██╔╝██║██║╚██╗██║██║",
  "╚██████╔╝██║ ╚═╝ ██║██║ ╚████║██║",
  " ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═══╝╚═╝",
]

export function LandingScreen(props: { status: StatusState; cwd: string }) {
  return (
    <box flexShrink={0} flexDirection="column" alignItems="center">
      <For each={LOGO}>{(line) => <text fg={theme.primary}>{line}</text>}</For>
      <box height={1} />
      <text fg={theme.textMuted}>a self-improving agent harness for open models</text>
      <box height={1} />
      <text fg={theme.textMuted}>
        model <span style={{ fg: theme.text }}>{props.status.modelName}</span>
      </text>
      <text fg={theme.textMuted}>
        cwd   <span style={{ fg: theme.text }}>{shorten(props.cwd, 60)}</span>
      </text>
    </box>
  )
}

function shorten(s: string, max: number): string {
  if (s.length <= max) return s
  return `…${s.slice(-(max - 1))}`
}
