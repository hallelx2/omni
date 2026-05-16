import { Show } from "solid-js"
import { theme } from "./theme.ts"
import type { StatusState } from "./state.ts"

/**
 * Right-rail sidebar — opencode pattern. Shows session info at top,
 * brand mark + version at bottom. Width 42, panel background, no
 * border (the chrome is the bg-color contrast).
 */
export function Sidebar(props: {
  status: StatusState
  cwd: string
  sessionId: string
  width?: number
}) {
  return (
    <box
      style={{
        width: props.width ?? 42,
        height: "100%",
        flexDirection: "column",
        backgroundColor: theme.backgroundPanel,
        paddingTop: 1,
        paddingBottom: 1,
        paddingLeft: 2,
        paddingRight: 2,
      }}
    >
      <text fg={theme.text}>{props.status.modelName}</text>
      <text fg={theme.textMuted}>{shortId(props.sessionId)}</text>

      <box style={{ height: 1 }} />

      <Show when={props.status.profile}>
        <Pill label="native"      on={props.status.profile?.nativeTools ?? false} />
        <Pill label="follows"     on={props.status.profile?.follows ?? false} />
        <Pill label="terse"       on={!props.status.profile?.verbose} />
      </Show>

      <box style={{ height: 1 }} />

      <Stat label="cwd"        value={shorten(props.cwd, 38)} />
      <Show when={props.status.skillName}>
        <Stat label="skill"    value={props.status.skillName ?? ""} accent={theme.accent} />
      </Show>
      <Stat
        label="tokens"
        value={`${props.status.usage.totalTokens.toLocaleString()}`}
      />
      <Show when={(props.status.usage.costUsd ?? 0) > 0}>
        <Stat
          label="cost"
          value={`$${(props.status.usage.costUsd ?? 0).toFixed(4)}`}
          accent={theme.warning}
        />
      </Show>
      <Show when={props.status.mcpServers > 0}>
        <Stat label="mcp" value={`${props.status.mcpServers} connected`} />
      </Show>
      <Show when={props.status.verifierPass + props.status.verifierFail > 0}>
        <Stat
          label="verify"
          value={`${props.status.verifierPass}✓ ${props.status.verifierFail}✗`}
          accent={props.status.verifierFail > 0 ? theme.warning : theme.success}
        />
      </Show>

      {/* Spring */}
      <box style={{ flexGrow: 1 }} />

      <box style={{ flexDirection: "row" }}>
        <text fg={theme.success}>• </text>
        <text fg={theme.text}>omni</text>
      </box>
      <text fg={theme.textMuted}>v0.1.0</text>
    </box>
  )
}

function Pill(props: { label: string; on: boolean }) {
  return (
    <box style={{ flexDirection: "row" }}>
      <text fg={props.on ? theme.success : theme.textMuted}>{props.on ? "● " : "○ "}</text>
      <text fg={props.on ? theme.text : theme.textMuted}>{props.label}</text>
    </box>
  )
}

function Stat(props: { label: string; value: string; accent?: string }) {
  return (
    <box style={{ flexDirection: "column", marginBottom: 1 }}>
      <text fg={theme.textMuted}>{props.label}</text>
      <text fg={props.accent ?? theme.text}>{props.value}</text>
    </box>
  )
}

function shortId(id: string): string {
  return id.length > 12 ? `…${id.slice(-12)}` : id
}

function shorten(s: string, max: number): string {
  if (s.length <= max) return s
  const head = Math.max(1, Math.floor((max - 1) / 2))
  const tail = Math.max(1, max - head - 1)
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}
