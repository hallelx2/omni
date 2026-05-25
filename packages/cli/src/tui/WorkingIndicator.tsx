import { For, Show, createSignal, onCleanup } from "solid-js"
import { RGBA } from "@opentui/core"
import { theme } from "./theme.ts"

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

/**
 * The whimsical "agent is working" line — Claude-Code style. A twinkling
 * star plus a rotating gerund, the whole word shimmering as a bright wave
 * travels across its characters. Shown at the bottom of the chat while a
 * run is in flight.
 */

const GERUNDS = [
  "Flibbertigibbeting", "Noodling", "Percolating", "Ruminating", "Conjuring",
  "Finagling", "Bamboozling", "Galumphing", "Wibbling", "Marinating",
  "Cogitating", "Frobnicating", "Spelunking", "Hornswoggling", "Discombobulating",
  "Kerfuffling", "Bedazzling", "Whirligigging", "Confabulating", "Tinkering",
  "Scheming", "Wrangling", "Brewing", "Summoning", "Untangling",
  "Pondering", "Mulling", "Hatching", "Tessellating", "Vibing",
]

const STARS = ["✶", "✸", "✹", "✺", "✷"]

function pick(): string {
  return GERUNDS[Math.floor(Math.random() * GERUNDS.length)]!
}

function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return RGBA.fromValues(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, 1)
}

/**
 * Per-character shimmer: each glyph's colour is interpolated between `base`
 * and `highlight` by a sine wave whose phase advances over time and offsets
 * by character index, so a bright crest sweeps left→right.
 */
export function ShimmerText(props: { text: string; base?: RGBA; highlight?: RGBA }) {
  const [phase, setPhase] = createSignal(0)
  const id = setInterval(() => setPhase((p) => (p + 1) % 100000), 90)
  onCleanup(() => clearInterval(id))
  const base = () => props.base ?? theme.textMuted
  const hi = () => props.highlight ?? theme.text
  const chars = () => [...props.text]
  return (
    <text>
      <For each={chars()}>
        {(ch, i) => {
          const t = () => {
            const wave = Math.sin(phase() * 0.35 - i() * 0.45)
            return Math.max(0, wave) ** 1.5 // mostly base, with a sharp travelling crest
          }
          return <span style={{ fg: mix(base(), hi(), t()) }}>{ch}</span>
        }}
      </For>
    </text>
  )
}

export function WorkingIndicator(props: { tokens?: number }) {
  const [word, setWord] = createSignal(pick())
  const wid = setInterval(() => setWord(pick()), 3500)
  onCleanup(() => clearInterval(wid))

  const [star, setStar] = createSignal(0)
  const sid = setInterval(() => setStar((i) => (i + 1) % STARS.length), 120)
  onCleanup(() => clearInterval(sid))

  const start = Date.now()
  const [elapsed, setElapsed] = createSignal(0)
  const eid = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
  onCleanup(() => clearInterval(eid))

  const meta = () => {
    const parts: string[] = []
    if (elapsed() > 0) parts.push(`${elapsed()}s`)
    if ((props.tokens ?? 0) > 0) parts.push(`${formatTokens(props.tokens!)} tokens`)
    return parts.join(" · ")
  }

  return (
    <box flexDirection="row" gap={1} paddingLeft={3} marginTop={1} flexShrink={0} alignItems="center">
      <text fg={theme.primary}>{STARS[star()]}</text>
      <ShimmerText text={`${word()}…`} highlight={theme.primary} />
      <Show when={meta()}>
        <text fg={theme.textMuted}>({meta()})</text>
      </Show>
    </box>
  )
}
