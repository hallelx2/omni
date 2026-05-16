import { For, Show } from "solid-js"
import type { MessageEntry, VerifierEntry } from "./state.ts"

export function MessageList(props: { messages: readonly MessageEntry[] }) {
  return (
    <scrollbox
      style={{
        flexGrow: 1,
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 1,
        paddingBottom: 1,
      }}
      stickyScroll
      stickyStart="bottom"
    >
      <For each={props.messages}>{(m) => <MessageRow m={m} />}</For>
    </scrollbox>
  )
}

function MessageRow(props: { m: MessageEntry }) {
  // Plain conditional rendering — Solid's <Switch>/<Match> doesn't narrow
  // discriminated unions cleanly across when-guards, so we just branch.
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

// ─── User ──────────────────────────────────────────────────────────────────

function UserMessage(props: { text: string }) {
  return (
    <box style={{ flexDirection: "column", marginTop: 1, marginBottom: 1 }}>
      <text fg="#3b82f6">▎you</text>
      <box style={{ paddingLeft: 2 }}>
        <text fg="#e2e8f0">{props.text}</text>
      </box>
    </box>
  )
}

// ─── Assistant ─────────────────────────────────────────────────────────────

function AssistantMessage(props: { text: string; streaming: boolean; thinking?: string }) {
  return (
    <box style={{ flexDirection: "column", marginTop: 1, marginBottom: 1 }}>
      <box style={{ flexDirection: "row" }}>
        <text fg="#a78bfa">▎omni</text>
        <Show when={props.streaming}>
          <text fg="#475569"> · streaming…</text>
        </Show>
      </box>
      <Show when={props.thinking}>
        <box style={{ paddingLeft: 2 }}>
          <text fg="#64748b">{props.thinking}</text>
        </box>
      </Show>
      <Show when={props.text.length > 0}>
        <box style={{ paddingLeft: 2 }}>
          <text fg="#e2e8f0">{props.text}</text>
        </box>
      </Show>
    </box>
  )
}

// ─── Tool ──────────────────────────────────────────────────────────────────

function ToolMessage(props: {
  entry: Extract<MessageEntry, { kind: "tool" }>
}) {
  return (
    <box style={{ flexDirection: "column", paddingLeft: 2, marginBottom: 1 }}>
      <box style={{ flexDirection: "row" }}>
        <text fg={statusColor(props.entry.status)}>{statusIcon(props.entry.status)}</text>
        <text fg="#94a3b8"> {props.entry.call.name}</text>
        <Show when={props.entry.durationMs !== undefined}>
          <text fg="#475569"> · {props.entry.durationMs}ms</text>
        </Show>
      </box>
      <box style={{ paddingLeft: 2 }}>
        <text fg="#475569">args: {truncate(JSON.stringify(props.entry.call.args), 160)}</text>
      </box>
      <Show when={props.entry.resultPreview}>
        <box style={{ paddingLeft: 2 }}>
          <text fg="#94a3b8">→ {props.entry.resultPreview}</text>
        </box>
      </Show>
      <Show when={props.entry.errorMessage}>
        <box style={{ paddingLeft: 2 }}>
          <text fg="#ef4444">! {props.entry.errorMessage}</text>
        </box>
      </Show>
      <Show when={props.entry.verifiers.length > 0}>
        <VerifierStrip verifiers={props.entry.verifiers} />
      </Show>
    </box>
  )
}

function VerifierStrip(props: { verifiers: readonly VerifierEntry[] }) {
  return (
    <box style={{ flexDirection: "column", paddingLeft: 2 }}>
      <For each={props.verifiers}>
        {(v) => (
          <box style={{ flexDirection: "row" }}>
            <text fg={verifierColor(v.status)}>{verifierIcon(v.status)}</text>
            <text fg="#64748b"> verify:{v.name}</text>
            <Show when={v.durationMs !== undefined}>
              <text fg="#334155"> ({v.durationMs}ms)</text>
            </Show>
            <Show when={v.status === "fail" && v.reason}>
              <text fg="#fca5a5"> — {v.reason}</text>
            </Show>
            <Show when={v.status === "skip" && v.reason}>
              <text fg="#64748b"> ({v.reason})</text>
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
    <box style={{ paddingLeft: 2 }}>
      <text fg={toneColor(props.tone)}>{tonePrefix(props.tone)} {props.text}</text>
    </box>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────

function statusIcon(s: Extract<MessageEntry, { kind: "tool" }>["status"]): string {
  switch (s) {
    case "running": return "▸"
    case "ok":      return "✓"
    case "error":   return "✗"
    case "denied":  return "⛔"
    case "invalid": return "⚠"
    case "pending": return "◌"
  }
}
function statusColor(s: Extract<MessageEntry, { kind: "tool" }>["status"]): string {
  switch (s) {
    case "running": return "#06b6d4"
    case "ok":      return "#10b981"
    case "error":   return "#ef4444"
    case "denied":  return "#f59e0b"
    case "invalid": return "#f59e0b"
    case "pending": return "#64748b"
  }
}

function verifierIcon(s: VerifierEntry["status"]): string {
  switch (s) {
    case "running": return "…"
    case "pass":    return "✓"
    case "fail":    return "✗"
    case "skip":    return "◌"
  }
}
function verifierColor(s: VerifierEntry["status"]): string {
  switch (s) {
    case "running": return "#06b6d4"
    case "pass":    return "#10b981"
    case "fail":    return "#ef4444"
    case "skip":    return "#64748b"
  }
}

function toneColor(t: "info" | "warn" | "error" | "dim"): string {
  switch (t) {
    case "info":  return "#94a3b8"
    case "warn":  return "#f59e0b"
    case "error": return "#ef4444"
    case "dim":   return "#475569"
  }
}
function tonePrefix(t: "info" | "warn" | "error" | "dim"): string {
  switch (t) {
    case "info":  return "ℹ"
    case "warn":  return "⚠"
    case "error": return "✗"
    case "dim":   return "·"
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}
