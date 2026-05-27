import { Show, For, createSignal, createEffect, onCleanup } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import type { ScrollBoxRenderable, MouseEvent as TuiMouseEvent, Renderable } from "@opentui/core"
import { MessageList } from "./MessageList.tsx"
import { InputBox, SLASH_COMMANDS } from "./InputBox.tsx"
import { LandingScreen } from "./LandingScreen.tsx"
import { SlashPopup } from "./SlashPopup.tsx"
import { StatsModal } from "./StatsModal.tsx"
import { FooterStrip } from "./FooterStrip.tsx"
import { ModalLayer, type ModalQueue } from "./modals/index.ts"
import { ToastStrip, type ToastStore } from "./Toast.tsx"
import { WorkingIndicator } from "./WorkingIndicator.tsx"
import { PermissionPrompt, type PermissionController } from "./PermissionPrompt.tsx"
import { theme, CONTENT_WIDTH } from "./theme.ts"
import type { TuiStore } from "./state.ts"

export interface AppHandlers {
  onSubmit: (text: string) => void | Promise<void>
  onAbort: () => void
  onQuit: () => void
}

/**
 * Root — full-width transcript with a centered prompt column. The transcript
 * scrolls in an internal scrollbox (wheel / pageup-pagedn / ctrl+u·d·g); the
 * session stats live behind ctrl+b. On an empty transcript the logo + prompt
 * are centered; once a conversation starts the prompt drops to the bottom.
 */
export function App(props: {
  store: TuiStore
  handlers: AppHandlers
  cwd: string
  sessionId: string
  modals: ModalQueue
  toasts: ToastStore
  permission: PermissionController
}) {
  const dimensions = useTerminalDimensions()
  const [inputValue, setInputValue] = createSignal("")
  const [inputHistory, setInputHistory] = createSignal<readonly string[]>([])
  const [queue, setQueue] = createSignal<readonly string[]>([])
  const [showStats, setShowStats] = createSignal(false)
  const [interruptArmed, setInterruptArmed] = createSignal(false)
  const showSlashPopup = () => inputValue().startsWith("/")
  const hasModal = () => props.modals.top() !== null
  const hasMessages = () => props.store.messages().length > 0

  createEffect(() => {
    if (!props.store.running()) setInterruptArmed(false)
  })

  // Type-ahead queue: messages submitted while a run is in flight are held and
  // auto-sent when the current run finishes (one at a time).
  let prevRunning = false
  createEffect(() => {
    const r = props.store.running()
    if (prevRunning && !r) {
      const q = queue()
      if (q.length > 0) {
        setQueue(q.slice(1))
        void props.handlers.onSubmit(q[0]!)
      }
    }
    prevRunning = r
  })
  let armTimer: ReturnType<typeof setTimeout> | undefined

  let scrollBox: ScrollBoxRenderable | undefined
  const pageStep = () => Math.max(1, Math.floor((scrollBox?.height ?? 20) / 2))

  // Catch-all wheel routing: forward any wheel that didn't already pass
  // through the scrollbox (pointer over the input, gaps, or centered margins)
  // to the transcript. Attached to the full-width body so it fires anywhere.
  const onTranscriptWheel = (e: TuiMouseEvent) => {
    let p: Renderable | null | undefined = e.target
    while (p) {
      if (p === scrollBox) return
      p = p.parent
    }
    const delta = Math.max(1, e.scroll?.delta ?? 1)
    if (e.scroll?.direction === "up") scrollBox?.scrollBy(-delta)
    else if (e.scroll?.direction === "down") scrollBox?.scrollBy(delta)
  }

  const [atBottom, setAtBottom] = createSignal(true)
  const bottomTimer = setInterval(() => {
    const sb = scrollBox
    if (sb) setAtBottom(sb.scrollTop >= sb.scrollHeight - sb.height - 2)
  }, 300)
  onCleanup(() => clearInterval(bottomTimer))
  const jumpToBottom = () => {
    if (scrollBox) scrollBox.scrollTo(scrollBox.scrollHeight)
  }

  useKeyboard((ev) => {
    if (props.permission.pending()) return
    if (showStats()) {
      if (ev.name === "escape" || (ev.ctrl && ev.name === "b")) setShowStats(false)
      return
    }
    if (hasModal()) return
    if (ev.ctrl && ev.name === "b") {
      setShowStats(true)
      return
    }
    if (ev.ctrl && ev.name === "c") {
      if (props.store.running()) props.handlers.onAbort()
      else props.handlers.onQuit()
      return
    }
    if (ev.name === "pageup" || (ev.ctrl && ev.name === "u")) {
      scrollBox?.scrollBy(-pageStep())
      return
    }
    if (ev.name === "pagedown" || (ev.ctrl && ev.name === "d")) {
      scrollBox?.scrollBy(pageStep())
      return
    }
    if (ev.ctrl && ev.name === "g") {
      jumpToBottom()
      return
    }
    if (ev.name === "escape") {
      if (props.store.running()) {
        if (interruptArmed()) {
          props.handlers.onAbort()
          setInterruptArmed(false)
        } else {
          setInterruptArmed(true)
          if (armTimer) clearTimeout(armTimer)
          armTimer = setTimeout(() => setInterruptArmed(false), 2000)
        }
        return
      }
      if (showSlashPopup()) setInputValue("")
    }
  })

  const onSubmit = (text: string) => {
    setInputHistory((h) => [...h, text].slice(-100))
    setInputValue("")
    // While busy, queue it (sent automatically when the run finishes); else send now.
    if (props.store.running()) setQueue((q) => [...q, text])
    else void props.handlers.onSubmit(text)
  }
  const onSlashComplete = (name: string) => setInputValue(`/${name} `)

  const slashEl = () => (
    <Show when={showSlashPopup() && !hasModal()}>
      <SlashPopup query={inputValue()} commands={SLASH_COMMANDS} onComplete={onSlashComplete} />
    </Show>
  )
  const inputEl = () => (
    <InputBox
      value={inputValue()}
      onChange={setInputValue}
      onSubmit={onSubmit}
      disabled={false}
      unfocused={hasModal() || showStats() || props.permission.pending() !== null}
      running={props.store.running()}
      modelName={props.store.status().modelName}
      skillName={props.store.status().skillName}
      iter={props.store.status().iter}
      maxIter={props.store.status().maxIter}
      totalTokens={props.store.status().usage.totalTokens}
      costUsd={props.store.status().usage.costUsd}
      interruptArmed={interruptArmed()}
    />
  )
  const queuedEl = () => (
    <Show when={queue().length > 0}>
      <box flexDirection="column" paddingLeft={3} flexShrink={0} marginTop={1}>
        <For each={queue()}>
          {(q, i) => (
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.primary }}>⏎</span> queued {i() + 1}: {q.length > 64 ? q.slice(0, 64) + "…" : q}
            </text>
          )}
        </For>
      </box>
    </Show>
  )

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background}
    >
      {/* body — full-width transcript; the prompt cluster stays centered */}
      <box flexGrow={1} minHeight={0} flexDirection="row" justifyContent="center" onMouseScroll={onTranscriptWheel}>
        <box flexGrow={1} minHeight={0} maxWidth={hasMessages() ? undefined : CONTENT_WIDTH} flexDirection="column" paddingLeft={2} paddingRight={2}>
          <Show
            when={hasMessages()}
            fallback={
              <box flexGrow={1} minHeight={0} flexDirection="column" justifyContent="center">
                <LandingScreen status={props.store.status()} cwd={props.cwd} />
                <box height={1} />
                {slashEl()}
                {inputEl()}
              </box>
            }
          >
            <MessageList messages={props.store.messages()} onScrollRef={(r) => (scrollBox = r)} />

            <box
              alignSelf="center"
              width="100%"
              maxWidth={CONTENT_WIDTH}
              flexDirection="column"
              flexShrink={0}
            >
              <Show when={props.store.running() && !props.permission.pending()}>
                <WorkingIndicator tokens={props.store.status().usage.totalTokens} />
              </Show>

              {slashEl()}

              <Show when={props.permission.pending()}>
                <PermissionPrompt request={props.permission.pending()!} />
              </Show>

              <Show when={!atBottom() && !props.permission.pending()}>
                <box paddingLeft={3} flexShrink={0} onMouseUp={jumpToBottom}>
                  <text fg={theme.primary}>
                    ↓ jump to latest <span style={{ fg: theme.textMuted }}>· ctrl+g</span>
                  </text>
                </box>
              </Show>

              {queuedEl()}
              {inputEl()}
            </box>
          </Show>
        </box>
      </box>

      <box flexShrink={0}>
        <FooterStrip
          status={props.store.status()}
          cwd={props.cwd}
          running={props.store.running()}
          hasInput={inputValue().length > 0}
        />
      </box>

      <ToastStrip toasts={props.toasts.toasts()} />
      <Show when={showStats()}>
        <StatsModal status={props.store.status()} cwd={props.cwd} sessionId={props.sessionId} />
      </Show>
      <ModalLayer queue={props.modals} />
    </box>
  )
}
