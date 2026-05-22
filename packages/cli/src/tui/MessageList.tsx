import { For, Show } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import { SplitBorder, theme, syntaxStyle } from "./theme.ts"
import type { MessageEntry, VerifierEntry } from "./state.ts"

export function MessageList(props: {
  messages: readonly MessageEntry[]
  onScrollRef?: (r: ScrollBoxRenderable) => void
}) {
  return (
    <scrollbox
      ref={(r: ScrollBoxRenderable) => props.onScrollRef?.(r)}
      flexGrow={1}
      paddingTop={1}
      paddingBottom={1}
      stickyScroll
      stickyStart="bottom"
    >
      <For each={props.messages}>{(m) => <MessageRow m={m} />}</For>
    </scrollbox>
  )
}

function MessageRow(props: { m: MessageEntry }) {
  const m = () => props.m
  return (
    <>
      <Show when={m().kind === "user"}>
        <UserMessage text={(m() as Extract<MessageEntry, { kind: "user" }>).text} />
      </Show>
      <Show when={m().kind === "assistant"}>
        {(() => {
          const a = m() as Extract<MessageEntry, { kind: "assistant" }>
          return <AssistantMessage text={a.text} streaming={a.streaming} thinking={a.thinking} />
        })()}
      </Show>
      <Show when={m().kind === "tool"}>
        <ToolMessage entry={m() as Extract<MessageEntry, { kind: "tool" }>} />
      </Show>
      <Show when={m().kind === "system"}>
        {(() => {
          const s = m() as Extract<MessageEntry, { kind: "system" }>
          return <SystemMessage text={s.text} tone={s.tone ?? "info"} />
        })()}
      </Show>
    </>
  )
}

// ─── User: left bar (primary) + panel bg, no label ─────────────────────────

function UserMessage(props: { text: string }) {
  return (
    <box
      {...SplitBorder}
      borderColor={theme.primary}
      backgroundColor={theme.backgroundPanel}
      marginTop={1}
      marginBottom={1}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
    >
      <text fg={theme.text}>{props.text}</text>
    </box>
  )
}

// ─── Assistant: paddingLeft 3, no label, no border ─────────────────────────

function AssistantMessage(props: { text: string; streaming: boolean; thinking?: string }) {
  return (
    <box flexDirection="column" marginTop={1} marginBottom={1}>
      <Show when={props.thinking}>
        <box paddingLeft={3}>
          <text fg={theme.textMuted}>▶ {props.thinking}</text>
        </box>
      </Show>
      <Show when={props.text.length > 0}>
        <box paddingLeft={3} flexShrink={0}>
          <markdown
            content={props.text}
            syntaxStyle={syntaxStyle()}
            streaming={props.streaming}
            internalBlockMode="top-level"
            tableOptions={{ style: "grid" }}
            fg={theme.markdownText}
            bg={theme.background}
          />
        </box>
      </Show>
      <Show when={props.streaming && props.text.length === 0}>
        <box paddingLeft={3}>
          <text fg={theme.textMuted}>…</text>
        </box>
      </Show>
    </box>
  )
}

// ─── Tool: inline icon + name + args, verifier strip below ─────────────────

function ToolMessage(props: { entry: Extract<MessageEntry, { kind: "tool" }> }) {
  return (
    <box flexDirection="column" paddingLeft={3}>
      <box flexDirection="row">
        <text fg={statusColor(props.entry.status)}>{statusIcon(props.entry.status)} </text>
        <text fg={theme.text}>{props.entry.call.name}</text>
        <text fg={theme.textMuted}>  {truncate(formatArgs(props.entry.call.args), 80)}</text>
        <Show when={props.entry.durationMs !== undefined}>
          <text fg={theme.textMuted}>  · {props.entry.durationMs}ms</text>
        </Show>
      </box>
      <Show when={props.entry.resultPreview}>
        <text fg={theme.textMuted}>    {props.entry.resultPreview}</text>
      </Show>
      <Show when={props.entry.errorMessage}>
        <text fg={theme.error}>    {props.entry.errorMessage}</text>
      </Show>
      <Show when={props.entry.verifiers.length > 0}>
        <VerifierStrip verifiers={props.entry.verifiers} />
      </Show>
    </box>
  )
}

function VerifierStrip(props: { verifiers: readonly VerifierEntry[] }) {
  return (
    <box flexDirection="column" paddingLeft={4}>
      <For each={props.verifiers}>
        {(v) => (
          <box flexDirection="row">
            <text fg={verifierColor(v.status)}>{verifierIcon(v.status)}</text>
            <text fg={theme.textMuted}> {v.name}</text>
            <Show when={v.durationMs !== undefined}>
              <text fg={theme.textMuted}> · {v.durationMs}ms</text>
            </Show>
            <Show when={v.status === "fail" && v.reason}>
              <text fg={theme.error}>  {v.reason}</text>
            </Show>
            <Show when={v.status === "skip" && v.reason}>
              <text fg={theme.textMuted}>  ({v.reason})</text>
            </Show>
          </box>
        )}
      </For>
    </box>
  )
}

// ─── System ────────────────────────────────────────────────────────────────

function SystemMessage(props: { text: string; tone: "info" | "warn" | "error" | "dim" }) {
  return (
    <box paddingLeft={3}>
      <text fg={toneColor(props.tone)}>{tonePrefix(props.tone)} {props.text}</text>
    </box>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────

function formatArgs(args: unknown): string {
  if (args === null || args === undefined) return ""
  if (typeof args === "string") return JSON.stringify(args)
  if (typeof args !== "object") return String(args)
  const obj = args as Record<string, unknown>
  const keys = Object.keys(obj)
  if (keys.length === 0) return ""
  if (keys.length === 1) {
    const v = obj[keys[0]!]
    return `${keys[0]}=${typeof v === "string" ? v : JSON.stringify(v)}`
  }
  return JSON.stringify(obj)
}

function statusIcon(s: Extract<MessageEntry, { kind: "tool" }>["status"]): string {
  switch (s) {
    case "running": return "▶"
    case "ok":      return "✓"
    case "error":   return "✗"
    case "denied":  return "⛔"
    case "invalid": return "△"
    case "pending": return "○"
  }
}
function statusColor(s: Extract<MessageEntry, { kind: "tool" }>["status"]): string {
  switch (s) {
    case "running": return theme.info
    case "ok":      return theme.success
    case "error":   return theme.error
    case "denied":  return theme.warning
    case "invalid": return theme.warning
    case "pending": return theme.textMuted
  }
}
function verifierIcon(s: VerifierEntry["status"]): string {
  switch (s) {
    case "running": return "…"
    case "pass":    return "✓"
    case "fail":    return "✗"
    case "skip":    return "○"
  }
}
function verifierColor(s: VerifierEntry["status"]): string {
  switch (s) {
    case "running": return theme.info
    case "pass":    return theme.success
    case "fail":    return theme.error
    case "skip":    return theme.textMuted
  }
}
function toneColor(t: "info" | "warn" | "error" | "dim"): string {
  switch (t) {
    case "info":  return theme.textMuted
    case "warn":  return theme.warning
    case "error": return theme.error
    case "dim":   return theme.textMuted
  }
}
function tonePrefix(t: "info" | "warn" | "error" | "dim"): string {
  switch (t) {
    case "info":  return "·"
    case "warn":  return "△"
    case "error": return "✗"
    case "dim":   return "·"
  }
}
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}
