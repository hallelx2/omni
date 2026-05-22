import { For, Show, createMemo, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { SplitBorder, selectedFg, theme } from "./theme.ts"

export interface SlashCommand {
  readonly name: string
  readonly hint: string
}

/**
 * Slash-command picker — opencode pattern. SplitBorder on left, menu
 * background, selected row is a full-width slab of theme.primary with
 * selectedFg() contrast. Top-level props throughout.
 */
export function SlashPopup(props: {
  query: string
  commands: readonly SlashCommand[]
  onComplete: (name: string) => void
}) {
  const filtered = createMemo(() => filter(props.commands, props.query))
  const [selected, setSelected] = createSignal(0)
  const longest = createMemo(() => filtered().reduce((m, c) => Math.max(m, c.name.length), 0))

  useKeyboard((ev) => {
    if (filtered().length === 0) return
    if (ev.name === "up") setSelected((i) => (i <= 0 ? filtered().length - 1 : i - 1))
    else if (ev.name === "down") setSelected((i) => (i >= filtered().length - 1 ? 0 : i + 1))
    else if (ev.name === "tab") {
      const picked = filtered()[selected()]
      if (picked) props.onComplete(picked.name)
    }
  })

  return (
    <box {...SplitBorder} borderColor={theme.border} flexShrink={0}>
      <box backgroundColor={theme.backgroundMenu} flexDirection="column">
        <Show
          when={filtered().length > 0}
          fallback={
            <box paddingLeft={1} paddingRight={1}>
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
                  flexDirection="row"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={sel() ? theme.primary : undefined}
                >
                  <text fg={fg()}>/{cmd.name.padEnd(longest() + 1)}</text>
                  <text fg={muted()}> {cmd.hint}</text>
                </box>
              )
            }}
          </For>
        </Show>
      </box>
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
