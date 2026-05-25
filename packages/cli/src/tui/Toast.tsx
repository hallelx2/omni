import { For, Show, createSignal, onCleanup } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { RGBA } from "@opentui/core"
import { SplitBorder, theme } from "./theme.ts"

export interface ToastEntry {
  readonly id: string
  readonly text: string
  readonly tone: "info" | "success" | "warn" | "error"
  readonly expiresAt: number
}

export function createToastStore() {
  const [toasts, setToasts] = createSignal<readonly ToastEntry[]>([], { equals: false })

  function push(text: string, tone: ToastEntry["tone"] = "info", durationMs = 3500): void {
    const id = `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    setToasts((prev) => [...prev, { id, text, tone, expiresAt: Date.now() + durationMs }])
  }

  // Tick every 500ms to expire toasts.
  const interval = setInterval(() => {
    const now = Date.now()
    setToasts((prev) => {
      const live = prev.filter((t) => t.expiresAt > now)
      return live.length === prev.length ? prev : live
    })
  }, 500)
  if (typeof onCleanup === "function") onCleanup(() => clearInterval(interval))

  return { toasts, push }
}

export type ToastStore = ReturnType<typeof createToastStore>

/**
 * Toast overlay — opencode's `ui/toast.tsx`: top-right, panel background,
 * a left+right `┃` border tinted to the variant colour, word-wrapped
 * message. opencode shows one at a time; we keep Omni's short stack and
 * render each in the same bordered idiom.
 */
export function ToastStrip(props: { toasts: readonly ToastEntry[] }) {
  const dim = useTerminalDimensions()
  return (
    <Show when={props.toasts.length > 0}>
      <box position="absolute" top={2} right={2} flexDirection="column" zIndex={2000}>
        <For each={props.toasts.slice(-4)}>
          {(t) => (
            <box
              marginBottom={1}
              maxWidth={Math.min(60, dim().width - 6)}
              paddingLeft={2}
              paddingRight={2}
              paddingTop={1}
              paddingBottom={1}
              backgroundColor={theme.backgroundPanel}
              border={["left", "right"]}
              borderColor={toneFg(t.tone)}
              customBorderChars={SplitBorder.customBorderChars}
            >
              <text fg={theme.text} wrapMode="word" width="100%">
                {t.text}
              </text>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

function toneFg(t: ToastEntry["tone"]): RGBA {
  switch (t) {
    case "success": return theme.success
    case "warn":    return theme.warning
    case "error":   return theme.error
    case "info":    return theme.info
  }
}
