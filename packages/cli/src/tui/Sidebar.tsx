import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme } from "./theme.ts"
import type { StatusState } from "./state.ts"

/**
 * Right-rail sidebar — opencode's `routes/session/sidebar.tsx`. Width 42,
 * panel background, a bold title with the session id beneath, a scrollbox
 * (themed scrollbar) of session info, and a brand mark pinned at the
 * bottom. Omni's harness stats (probe profile, skill, tokens, verifier
 * tally) live in the scrollbox, styled in opencode's idiom.
 */
export function Sidebar(props: {
  status: StatusState
  cwd: string
  sessionId: string
  width?: number
}) {
  return (
    <box
      width={props.width ?? 42}
      height="100%"
      flexShrink={0}
      flexDirection="column"
      backgroundColor={theme.backgroundPanel}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
    >
      <scrollbox
        flexGrow={1}
        verticalScrollbarOptions={{
          trackOptions: {
            backgroundColor: theme.background,
            foregroundColor: theme.borderActive,
          },
        }}
      >
        <box flexShrink={0} gap={1} paddingRight={1} flexDirection="column">
          <box paddingRight={1} flexDirection="column">
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {props.status.modelName}
            </text>
            <text fg={theme.textMuted}>{shortId(props.sessionId)}</text>
          </box>

          <Show when={props.status.profile}>
            <box flexDirection="column">
              <Pill label="native tools" on={props.status.profile?.nativeTools ?? false} />
              <Pill label="follows" on={props.status.profile?.follows ?? false} />
              <Pill label="terse" on={!props.status.profile?.verbose} />
            </box>
          </Show>

          <box flexDirection="column" gap={1}>
            <Stat
              label="mode"
              value={props.status.mode}
              accent={
                props.status.mode === "plan"
                  ? theme.warning
                  : props.status.mode === "auto"
                    ? theme.accent
                    : theme.success
              }
            />
            <Stat label="cwd" value={shorten(props.cwd, 36)} />
            <Show when={props.status.skillName}>
              <Stat label="skill" value={props.status.skillName ?? ""} accent={theme.accent} />
            </Show>
            <Stat label="tokens" value={props.status.usage.totalTokens.toLocaleString()} />
            <Show when={(props.status.usage.costUsd ?? 0) > 0}>
              <Stat label="cost" value={`$${(props.status.usage.costUsd ?? 0).toFixed(4)}`} accent={theme.warning} />
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
          </box>
        </box>
      </scrollbox>

      <box flexShrink={0} paddingTop={1}>
        <text fg={theme.textMuted}>
          <span style={{ fg: theme.success }}>•</span> <span style={{ fg: theme.text }}>omni</span> v0.1.0
        </text>
      </box>
    </box>
  )
}

function Pill(props: { label: string; on: boolean }) {
  return (
    <text fg={props.on ? theme.text : theme.textMuted}>
      <span style={{ fg: props.on ? theme.success : theme.textMuted }}>{props.on ? "● " : "○ "}</span>
      {props.label}
    </text>
  )
}

function Stat(props: { label: string; value: string; accent?: import("@opentui/core").RGBA }) {
  return (
    <box flexDirection="column">
      <text fg={theme.textMuted}>{props.label}</text>
      <text fg={props.accent ?? theme.text}>{props.value}</text>
    </box>
  )
}

function shortId(id: string): string {
  return id.length > 14 ? `…${id.slice(-14)}` : id
}
function shorten(s: string, max: number): string {
  if (s.length <= max) return s
  const head = Math.max(1, Math.floor((max - 1) / 2))
  const tail = Math.max(1, max - head - 1)
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}
