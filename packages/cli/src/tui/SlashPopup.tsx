import { For, Show, createMemo, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"

export interface SlashCommand {
  readonly name: string
  readonly hint: string
}

/**
 * Floating list of slash commands that filters as you type and lets you
 * arrow-select + Tab to autocomplete. Mounts above the input box only
 * while the input starts with "/".
 *
 * The popup intercepts up/down/tab via useKeyboard. It calls
 * `onComplete(name)` to insert the chosen command into the input. It
 * never submits — the user still has to hit Enter to actually run the
 * command, so they can edit args after the command name.
 */
export function SlashPopup(props: {
  query: string
  commands: readonly SlashCommand[]
  onComplete: (name: string) => void
}) {
  const filtered = createMemo(() => filter(props.commands, props.query))
  const [selected, setSelected] = createSignal(0)

  // Reset selection when filter changes.
  let lastQuery = props.query
  const ensureBounds = () => {
    if (props.query !== lastQuery) {
      lastQuery = props.query
      setSelected(0)
    }
    const max = Math.max(0, filtered().length - 1)
    if (selected() > max) setSelected(max)
  }

  useKeyboard((ev) => {
    ensureBounds()
    if (filtered().length === 0) return
    if (ev.name === "up") {
      setSelected((i) => (i <= 0 ? filtered().length - 1 : i - 1))
    } else if (ev.name === "down") {
      setSelected((i) => (i >= filtered().length - 1 ? 0 : i + 1))
    } else if (ev.name === "tab") {
      const picked = filtered()[selected()]
      if (picked) props.onComplete(picked.name)
    }
  })

  return (
    <box
      style={{
        flexDirection: "column",
        borderStyle: "rounded",
        borderColor: "#334155",
        backgroundColor: "#0f172a",
        paddingLeft: 1,
        paddingRight: 1,
        maxHeight: 8,
      }}
    >
      <Show
        when={filtered().length > 0}
        fallback={
          <text fg="#475569">no matching command  ·  try /help</text>
        }
      >
        <For each={filtered()}>
          {(cmd, i) => {
            const isSel = () => i() === selected()
            return (
              <box
                style={{
                  flexDirection: "row",
                  backgroundColor: isSel() ? "#1e293b" : "transparent",
                }}
              >
                <text fg={isSel() ? "#06b6d4" : "#94a3b8"}>
                  {isSel() ? "› " : "  "}
                </text>
                <text fg={isSel() ? "#e2e8f0" : "#cbd5e1"}>/{cmd.name}</text>
                <text fg="#475569">  {cmd.hint}</text>
              </box>
            )
          }}
        </For>
      </Show>
      <Show when={filtered().length > 0}>
        <box style={{ flexDirection: "row", marginTop: 0 }}>
          <text fg="#334155">↑↓ navigate  ·  tab to insert  ·  ⏎ to run  ·  esc to cancel</text>
        </box>
      </Show>
    </box>
  )
}

function filter(cmds: readonly SlashCommand[], query: string): readonly SlashCommand[] {
  const q = query.startsWith("/") ? query.slice(1) : query
  const lower = q.toLowerCase().trim()
  if (lower.length === 0) return cmds
  // Prefix matches first, then substring matches.
  const prefix: SlashCommand[] = []
  const substring: SlashCommand[] = []
  for (const c of cmds) {
    const n = c.name.toLowerCase()
    if (n.startsWith(lower)) prefix.push(c)
    else if (n.includes(lower)) substring.push(c)
  }
  return [...prefix, ...substring]
}
