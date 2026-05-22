import { For, Show, createSignal, onCleanup } from "solid-js"
import { theme } from "./theme.ts"

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

export function ToastStrip(props: { toasts: readonly ToastEntry[] }) {
  return (
    <Show when={props.toasts.length > 0}>
      <box position="absolute" top={1} right={2} flexDirection="column" zIndex={2000}>
        <For each={props.toasts.slice(-4)}>
          {(t) => (
            <box marginBottom={1} paddingLeft={2} paddingRight={2} backgroundColor={theme.backgroundPanel}>
              <text fg={toneFg(t.tone)}>{toneIcon(t.tone)} {t.text}</text>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

function toneIcon(t: ToastEntry["tone"]): string {
  switch (t) {
    case "success": return "✓"
    case "warn":    return "⚠"
    case "error":   return "✗"
    case "info":    return "ℹ"
  }
}
function toneFg(t: ToastEntry["tone"]): string {
  switch (t) {
    case "success": return theme.success
    case "warn":    return theme.warning
    case "error":   return theme.error
    case "info":    return theme.text
  }
}
