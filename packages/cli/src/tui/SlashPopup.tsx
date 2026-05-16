import { For, Show, createMemo, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { SplitBorder, selectedFg, theme } from "./theme.ts"

export interface SlashCommand {
  readonly name: string
  readonly hint: string
}

/**
 * Slash-command picker (opencode pattern):
 *   - Floats directly above the input, same effective width
 *   - SplitBorder on left + bg=backgroundMenu
 *   - Selected row is a FULL-WIDTH slab of theme.primary, fg = selectedFg(primary)
 *   - Filter is prefix-first, then substring; limit 10
 *   - ↑↓ navigates, tab inserts, ⏎ submits, esc clears
 */
export function SlashPopup(props: {
  query: string
  commands: readonly SlashCommand[]
  onComplete: (name: string) => void
}) {
  const filtered = createMemo(() => filter(props.commands, props.query))
  const [selected, setSelected] = createSignal(0)
  const longest = createMemo(() =>
    filtered().reduce((m, c) => Math.max(m, c.name.length), 0),
  )

  useKeyboard((ev) => {
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
        backgroundColor: theme.backgroundMenu,
        border: SplitBorder.sides as never,
        borderColor: theme.border,
        customBorderChars: SplitBorder.chars as never,
        marginBottom: 0,
      }}
    >
      <Show
        when={filtered().length > 0}
        fallback={
          <box style={{ paddingLeft: 1, paddingRight: 1 }}>
            <text fg={theme.textMuted}>no matching commands</text>
          </box>
        }
      >
        <For each={filtered().slice(0, 10)}>
          {(cmd, i) => {
            const sel = () => i() === selected()
            const fg = () => (sel() ? selectedFg(theme.primary) : theme.text)
            const muted = () => (sel() ? selectedFg(theme.primary) : theme.textMuted)
            return (
              <box
                style={{
                  flexDirection: "row",
                  paddingLeft: 1,
                  paddingRight: 1,
                  backgroundColor: sel() ? theme.primary : undefined,
                }}
              >
                <text fg={fg()}>/{cmd.name.padEnd(longest() + 1)}</text>
                <text fg={muted()}> {cmd.hint}</text>
              </box>
            )
          }}
        </For>
      </Show>
    </box>
  )
}

function filter(cmds: readonly SlashCommand[], query: string): readonly SlashCommand[] {
  const q = query.startsWith("/") ? query.slice(1) : query
  const lower = q.toLowerCase().trim()
  if (lower.length === 0) return cmds
  const prefix: SlashCommand[] = []
  const substring: SlashCommand[] = []
  for (const c of cmds) {
    const n = c.name.toLowerCase()
    if (n.startsWith(lower)) prefix.push(c)
    else if (n.includes(lower)) substring.push(c)
  }
  return [...prefix, ...substring]
}
