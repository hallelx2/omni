import { Show } from "solid-js"
import type { StatusState } from "./state.ts"

export function LandingScreen(props: { status: StatusState; cwd: string }) {
  return (
    <box
      style={{
        flexGrow: 1,
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <box style={{ flexDirection: "column", alignItems: "flex-start" }}>
        <text fg="#06b6d4">◆</text>
        <box style={{ height: 1 }} />
        <text fg="#94a3b8">a self-improving agent harness for open models</text>

        <box style={{ height: 1 }} />

        <box style={{ flexDirection: "row" }}>
          <text fg="#64748b">model </text>
          <text fg="#e2e8f0">{props.status.modelName}</text>
          <Show when={props.status.profile}>
            <text fg="#475569">  ·  </text>
            <text fg={props.status.profile?.nativeTools ? "#10b981" : "#64748b"}>
              {props.status.profile?.nativeTools ? "native tools" : "react fallback"}
            </text>
            <text fg="#475569">  ·  </text>
            <text fg={props.status.profile?.follows ? "#10b981" : "#f59e0b"}>
              {props.status.profile?.follows ? "instruction-following" : "loose"}
            </text>
          </Show>
        </box>

        <box style={{ flexDirection: "row" }}>
          <text fg="#64748b">cwd   </text>
          <text fg="#94a3b8">{props.cwd}</text>
        </box>

        <Show when={props.status.mcpServers > 0}>
          <box style={{ flexDirection: "row" }}>
            <text fg="#64748b">mcp   </text>
            <text fg="#06b6d4">{props.status.mcpServers} server(s) connected</text>
          </box>
        </Show>

        <box style={{ height: 1 }} />

        <text fg="#475569">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</text>
        <box style={{ height: 1 }} />

        <Hint shortcut="/" text="browse commands" />
        <Hint shortcut="⏎" text="send · ctrl-c to abort or quit" />
        <Hint shortcut="↑↓" text="cycle previous inputs" />
      </box>
    </box>
  )
}

function Hint(props: { shortcut: string; text: string }) {
  return (
    <box style={{ flexDirection: "row" }}>
      <text fg="#a78bfa">{props.shortcut.padEnd(4)}</text>
      <text fg="#64748b"> {props.text}</text>
    </box>
  )
}

