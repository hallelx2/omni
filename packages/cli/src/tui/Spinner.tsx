import { Show, createSignal, onCleanup, type JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import { theme } from "./theme.ts"

/**
 * Braille spinner — opencode's `component/spinner.tsx`, reimplemented as a
 * timer-driven Solid component because the `opentui-spinner` package (which
 * provides opencode's native `<spinner>` element) isn't a dependency here.
 *
 * Same frames, same ~80ms cadence, same API:
 *   <Spinner color={theme.accent}>Thinking…</Spinner>
 */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

export function Spinner(props: { children?: JSX.Element; color?: RGBA; interval?: number }) {
  const color = () => props.color ?? theme.textMuted
  const [frame, setFrame] = createSignal(0)

  const id = setInterval(() => {
    setFrame((i) => (i + 1) % SPINNER_FRAMES.length)
  }, props.interval ?? 80)
  onCleanup(() => clearInterval(id))

  return (
    <box flexDirection="row" gap={1}>
      <text fg={color()}>{SPINNER_FRAMES[frame()]}</text>
      <Show when={props.children}>
        <text fg={color()}>{props.children}</text>
      </Show>
    </box>
  )
}
