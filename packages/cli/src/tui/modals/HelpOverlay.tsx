import { useKeyboard } from "@opentui/solid"
import { Modal } from "./Modal.tsx"
import type { HelpModalSpec } from "./types.ts"

export function HelpOverlay(props: { spec: HelpModalSpec }) {
  useKeyboard((ev) => {
    if (ev.name === "escape" || ev.name === "q" || ev.name === "return" || ev.name === "enter") {
      props.spec.resolve()
    }
  })

  return (
    <Modal title="help" subtitle="keys, slash commands, shortcuts" width={88}>
      <box style={{ flexDirection: "row" }}>
        <Column
          heading="keys"
          rows={[
            ["⏎",       "send"],
            ["↑↓",       "history"],
            ["/",         "open command palette"],
            ["esc",       "close popup / cancel modal"],
            ["ctrl-c",    "abort run · second tap quits"],
            ["ctrl-l",    "clear (where supported)"],
          ]}
        />
        <box style={{ width: 4 }} />
        <Column
          heading="slash commands"
          rows={[
            ["/help",     "this screen"],
            ["/quit",     "exit"],
            ["/clear",    "clear screen"],
            ["/sessions", "list past sessions"],
            ["/continue <id>", "resume a session"],
            ["/skill <name|off>", "pin/unpin a skill"],
            ["/skills",   "list skills"],
            ["/mcp",      "manage MCP servers"],
            ["/model",    "show adapter + model"],
            ["/profile",  "show probed profile"],
            ["/usage",    "tokens + cost"],
            ["/paths",    "~/.omni paths"],
          ]}
        />
      </box>
      <box style={{ height: 1 }} />
      <text fg="#475569">  ⏎ or esc to close</text>
    </Modal>
  )
}

function Column(props: {
  heading: string
  rows: ReadonlyArray<readonly [string, string]>
}) {
  return (
    <box style={{ flexDirection: "column" }}>
      <text fg="#a78bfa">{props.heading}</text>
      <box style={{ height: 1 }} />
      {props.rows.map(([k, v]) => (
        <box style={{ flexDirection: "row" }}>
          <text fg="#06b6d4">{k.padEnd(18)}</text>
          <text fg="#cbd5e1">{v}</text>
        </box>
      ))}
    </box>
  )
}
