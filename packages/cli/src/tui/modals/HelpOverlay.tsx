import { useKeyboard } from "@opentui/solid"
import { Modal } from "./Modal.tsx"
import { theme } from "../theme.ts"
import type { HelpModalSpec } from "./types.ts"

export function HelpOverlay(props: { spec: HelpModalSpec }) {
  useKeyboard((ev) => {
    if (ev.name === "escape" || ev.name === "q" || ev.name === "return" || ev.name === "enter") {
      props.spec.resolve()
    }
  })

  return (
    <Modal title="Help" subtitle="keys · slash commands · shortcuts" width="large">
      <box flexDirection="row" paddingLeft={4} paddingRight={4}>
        <Column
          heading="keys"
          rows={[
            ["⏎",       "send"],
            ["↑↓",       "history"],
            ["/",         "open command palette"],
            ["esc",       "close popup / cancel modal"],
            ["ctrl+b",    "toggle sidebar"],
            ["ctrl+c",    "abort run · second tap quits"],
          ]}
        />
        <box width={4} />
        <Column
          heading="commands"
          rows={[
            ["/help",            "this screen"],
            ["/quit · /exit",    "exit"],
            ["/clear",           "clear screen"],
            ["/sessions",        "list past sessions"],
            ["/continue <id>",   "resume a session"],
            ["/skill <name|off>","pin/unpin a skill"],
            ["/skills",          "list skills"],
            ["/mcp",             "manage MCP servers"],
            ["/model",           "show adapter + model"],
            ["/profile",         "show probed profile"],
            ["/usage",           "tokens + cost"],
            ["/paths",           "~/.omni paths"],
          ]}
        />
      </box>
      <box height={1} />
      <box paddingLeft={4} paddingRight={4}>
        <text fg={theme.textMuted}>⏎ or esc to close</text>
      </box>
    </Modal>
  )
}

function Column(props: {
  heading: string
  rows: ReadonlyArray<readonly [string, string]>
}) {
  return (
    <box flexDirection="column">
      <text fg={theme.accent}>{props.heading}</text>
      <box height={1} />
      {props.rows.map(([k, v]) => (
        <box flexDirection="row">
          <text fg={theme.text}>{k.padEnd(20)}</text>
          <text fg={theme.textMuted}>{v}</text>
        </box>
      ))}
    </box>
  )
}
