import { Show } from "solid-js"
import type { StatusState } from "./state.ts"

export function StatusBar(props: { status: StatusState; running: boolean }) {
  return (
    <box
      style={{
        flexDirection: "row",
        height: 1,
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: "#1e293b",
      }}
    >
      <text fg="#06b6d4">⚡ omni</text>
      <text fg="#475569"> · </text>
      <text fg="#e2e8f0">{props.status.modelName}</text>

      <Show when={props.status.profile}>
        <text fg="#475569"> · </text>
        <text fg={props.status.profile?.nativeTools ? "#10b981" : "#64748b"}>
          {props.status.profile?.nativeTools ? "●" : "○"}native-tools
        </text>
        <text fg="#475569"> </text>
        <text fg={props.status.profile?.follows ? "#10b981" : "#64748b"}>
          {props.status.profile?.follows ? "●" : "○"}follows
        </text>
        <text fg="#475569"> </text>
        <text fg={props.status.profile?.verbose ? "#f59e0b" : "#10b981"}>
          {props.status.profile?.verbose ? "●verbose" : "●terse"}
        </text>
      </Show>

      <box style={{ flexGrow: 1 }} />

      <Show when={props.running}>
        <text fg="#f59e0b">● </text>
        <text fg="#94a3b8">iter {props.status.iter}/{props.status.maxIter}</text>
        <text fg="#475569"> · </text>
      </Show>

      <Show when={props.status.skillName}>
        <text fg="#a78bfa">🎯 {props.status.skillName}</text>
        <text fg="#475569"> · </text>
      </Show>

      <Show when={props.status.memoryHits > 0}>
        <text fg="#ec4899">📦 mem:{props.status.memoryHits}</text>
        <text fg="#475569"> · </text>
      </Show>

      <Show when={props.status.mcpServers > 0}>
        <text fg="#06b6d4">🔌 mcp:{props.status.mcpServers}</text>
        <text fg="#475569"> · </text>
      </Show>

      <Show when={props.status.verifierPass + props.status.verifierFail > 0}>
        <text fg="#10b981">✓{props.status.verifierPass}</text>
        <Show when={props.status.verifierFail > 0}>
          <text fg="#ef4444"> ✗{props.status.verifierFail}</text>
        </Show>
        <text fg="#475569"> · </text>
      </Show>

      <text fg="#94a3b8">
        {formatTokens(props.status.usage.totalTokens)} tok
      </text>
      <Show when={(props.status.usage.costUsd ?? 0) > 0}>
        <text fg="#475569"> · </text>
        <text fg="#fbbf24">${(props.status.usage.costUsd ?? 0).toFixed(4)}</text>
      </Show>
    </box>
  )
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(2)}K`
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`
  return `${(n / 1_000_000).toFixed(2)}M`
}
