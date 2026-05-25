import { Show } from "solid-js"
import { TextAttributes, type RGBA } from "@opentui/core"
import { Modal } from "./modals/Modal.tsx"
import { theme } from "./theme.ts"
import type { StatusState } from "./state.ts"

/**
 * Session stats as a centered modal (toggled with ctrl+b) — replaces the
 * always-on right rail so the chat gets the full width. Same content the
 * sidebar carried: model, session id, probe profile, cwd, usage, mcp,
 * verifier tally.
 */
export function StatsModal(props: { status: StatusState; cwd: string; sessionId: string }) {
  const s = () => props.status
  return (
    <Modal title="session" subtitle={s().modelName} width="medium">
      <box paddingLeft={4} paddingRight={4} flexDirection="column" gap={1}>
        <text fg={theme.textMuted}>{shortId(props.sessionId)}</text>

        <Show when={s().profile}>
          <box flexDirection="column">
            <Pill label="native tools" on={s().profile?.nativeTools ?? false} />
            <Pill label="follows" on={s().profile?.follows ?? false} />
            <Pill label="terse" on={!s().profile?.verbose} />
          </box>
        </Show>

        <box flexDirection="column" gap={1}>
          <Stat
            label="mode"
            value={s().mode}
            accent={s().mode === "plan" ? theme.warning : theme.success}
          />
          <Stat label="cwd" value={shorten(props.cwd, 50)} />
          <Show when={s().skillName}>
            <Stat label="skill" value={s().skillName ?? ""} accent={theme.accent} />
          </Show>
          <Stat label="tokens" value={s().usage.totalTokens.toLocaleString()} />
          <Show when={(s().usage.costUsd ?? 0) > 0}>
            <Stat label="cost" value={`$${(s().usage.costUsd ?? 0).toFixed(4)}`} accent={theme.warning} />
          </Show>
          <Show when={s().mcpServers > 0}>
            <Stat label="mcp" value={`${s().mcpServers} connected`} />
          </Show>
          <Show when={s().verifierPass + s().verifierFail > 0}>
            <Stat
              label="verify"
              value={`${s().verifierPass}✓ ${s().verifierFail}✗`}
              accent={s().verifierFail > 0 ? theme.warning : theme.success}
            />
          </Show>
        </box>

        <text fg={theme.textMuted}>esc · ctrl+b to close</text>
      </box>
    </Modal>
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

function Stat(props: { label: string; value: string; accent?: RGBA }) {
  return (
    <box flexDirection="column">
      <text fg={theme.textMuted}>{props.label}</text>
      <text fg={props.accent ?? theme.text}>{props.value}</text>
    </box>
  )
}

function shortId(id: string): string {
  return id.length > 20 ? `…${id.slice(-20)}` : id
}
function shorten(s: string, max: number): string {
  if (s.length <= max) return s
  const head = Math.max(1, Math.floor((max - 1) / 2))
  const tail = Math.max(1, max - head - 1)
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}
