import { For, Show, Switch, Match, createSignal, type JSX } from "solid-js"
import { ScrollBoxRenderable, TextAttributes, type RGBA } from "@opentui/core"
import { SplitBorder, theme, syntaxStyle } from "./theme.ts"
import { Spinner } from "./Spinner.tsx"
import { toolIcon, toolLabel, toolBlock } from "./tool-format.ts"
import type { MessageEntry, VerifierEntry } from "./state.ts"

export function MessageList(props: {
  messages: readonly MessageEntry[]
  onScrollRef?: (r: ScrollBoxRenderable) => void
}) {
  return (
    <scrollbox
      ref={(r: ScrollBoxRenderable) => props.onScrollRef?.(r)}
      flexGrow={1}
      paddingTop={1}
      paddingBottom={1}
      stickyScroll
      stickyStart="bottom"
      viewportOptions={{ paddingRight: 1 }}
      verticalScrollbarOptions={{
        paddingLeft: 1,
        trackOptions: {
          backgroundColor: theme.backgroundElement,
          foregroundColor: theme.border,
        },
      }}
      horizontalScrollbarOptions={{ visible: false }}
    >
      <For each={props.messages}>{(m, i) => <MessageRow m={m} first={i() === 0} />}</For>
    </scrollbox>
  )
}

function MessageRow(props: { m: MessageEntry; first: boolean }) {
  const m = () => props.m
  return (
    <Switch>
      <Match when={m().kind === "user"}>
        <UserMessage text={(m() as Extract<MessageEntry, { kind: "user" }>).text} first={props.first} />
      </Match>
      <Match when={m().kind === "assistant"}>
        {(() => {
          const a = m() as Extract<MessageEntry, { kind: "assistant" }>
          return <AssistantMessage text={a.text} streaming={a.streaming} thinking={a.thinking} />
        })()}
      </Match>
      <Match when={m().kind === "tool"}>
        <ToolMessage entry={m() as Extract<MessageEntry, { kind: "tool" }>} />
      </Match>
      <Match when={m().kind === "system"}>
        {(() => {
          const s = m() as Extract<MessageEntry, { kind: "system" }>
          return <SystemMessage text={s.text} tone={s.tone ?? "info"} />
        })()}
      </Match>
    </Switch>
  )
}

// ─── User: left bar (primary) + panel bg, no label — opencode UserMessage ──

function UserMessage(props: { text: string; first: boolean }) {
  const [hover, setHover] = createSignal(false)
  return (
    <box
      border={["left"]}
      borderColor={theme.primary}
      customBorderChars={SplitBorder.customBorderChars}
      marginTop={props.first ? 0 : 1}
    >
      <box
        onMouseOver={() => setHover(true)}
        onMouseOut={() => setHover(false)}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
        flexShrink={0}
      >
        <text fg={theme.text}>{props.text}</text>
      </box>
    </box>
  )
}

// ─── Assistant: reasoning (collapsed) + markdown at paddingLeft 3 ──────────

function AssistantMessage(props: { text: string; streaming: boolean; thinking?: string }) {
  return (
    <box flexDirection="column">
      <Show when={props.thinking}>
        <Switch>
          <Match when={props.streaming}>
            <box paddingLeft={3} marginTop={1}>
              <Spinner color={theme.textMuted}>Thinking</Spinner>
            </box>
          </Match>
          <Match when={true}>
            <box paddingLeft={3} marginTop={1} flexShrink={0}>
              <text fg={theme.warning} wrapMode="none">
                + Thought
              </text>
            </box>
          </Match>
        </Switch>
      </Show>
      <Show when={props.text.length > 0}>
        <box paddingLeft={3} marginTop={1} flexShrink={0}>
          <markdown
            content={bulletize(props.text.trim())}
            syntaxStyle={syntaxStyle()}
            streaming={props.streaming}
            internalBlockMode="top-level"
            tableOptions={{ style: "grid", wrapMode: "word", borderColor: theme.border }}
            conceal={true}
            fg={theme.markdownText}
            bg={theme.background}
          />
        </box>
      </Show>
      <Show when={props.streaming && props.text.length === 0 && !props.thinking}>
        <box paddingLeft={3} marginTop={1}>
          <Spinner color={theme.textMuted} />
        </box>
      </Show>
    </box>
  )
}

// ─── Tool: opencode InlineTool / BlockTool idiom ──────────────────────────

function ToolMessage(props: { entry: Extract<MessageEntry, { kind: "tool" }> }) {
  const e = () => props.entry
  const name = () => e().call.name
  const label = () => toolLabel(name(), e().call.args as Record<string, unknown>, e().result)
  const block = () => (e().status === "ok" ? toolBlock(name(), e().result) : null)
  const denied = () => e().status === "denied"
  const complete = () => e().status !== "running" && e().status !== "pending"
  // Completed tools read muted (opencode idiom); failures/denials keep their signal colour.
  const iconColor = () => (e().status === "ok" ? theme.textMuted : statusColor(e().status))

  return (
    <box flexDirection="column">
      <Switch>
        {/* subagent → distinct peek panel (live child activity + expand) */}
        <Match when={e().subagent}>
          <SubagentTool entry={e()} />
        </Match>
        {/* tool with output worth showing (bash) → collapsible block */}
        <Match when={block()}>
          <BlockTool title={`${toolIcon(name())} ${label()}`} output={block()!} />
          <Show when={e().verifiers.length > 0}>
            <VerifierStrip verifiers={e().verifiers} />
          </Show>
        </Match>
        {/* otherwise → one-line tool row (no JSON) */}
        <Match when={true}>
          <InlineTool
            icon={toolIcon(name())}
            iconColor={iconColor()}
            complete={complete()}
            spinner={e().status === "running"}
            pending={`${label()}…`}
            denied={denied()}
            error={e().errorMessage}
          >
            {label()}
          </InlineTool>
          <Show when={e().verifiers.length > 0}>
            <VerifierStrip verifiers={e().verifiers} />
          </Show>
        </Match>
      </Switch>
    </box>
  )
}

function InlineTool(props: {
  icon: string
  iconColor?: RGBA
  complete: boolean
  pending: string
  spinner?: boolean
  denied?: boolean
  error?: string
  duration?: number
  children: JSX.Element
}) {
  const fg = () => (props.complete ? theme.textMuted : theme.text)
  return (
    <box paddingLeft={3} marginTop={1}>
      <Switch>
        <Match when={props.spinner}>
          <Spinner color={fg()}>{props.children}</Spinner>
        </Match>
        <Match when={true}>
          <text
            paddingLeft={3}
            fg={props.denied ? theme.textMuted : fg()}
            attributes={props.denied ? TextAttributes.STRIKETHROUGH : undefined}
          >
            <Show fallback={<>~ {props.pending}</>} when={props.complete}>
              <span style={{ fg: props.iconColor }}>{props.icon}</span> {props.children}
              <Show when={props.duration !== undefined}>
                <span style={{ fg: theme.textMuted }}> · {props.duration}ms</span>
              </Show>
            </Show>
          </text>
        </Match>
      </Switch>
      <Show when={props.error && !props.denied}>
        <text paddingLeft={3} fg={theme.error}>
          {props.error}
        </text>
      </Show>
    </box>
  )
}

function BlockTool(props: { title: string; output: string }) {
  const [expanded, setExpanded] = createSignal(false)
  const lines = () => props.output.split("\n")
  const overflow = () => lines().length > 3 || props.output.length > 240
  const shown = () => {
    if (expanded() || !overflow()) return props.output
    return lines().slice(0, 3).join("\n").slice(0, 240)
  }
  return (
    <box
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      marginTop={1}
      gap={1}
      backgroundColor={theme.backgroundPanel}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.background}
      onMouseUp={() => overflow() && setExpanded((p) => !p)}
    >
      <text paddingLeft={3} fg={theme.textMuted}>
        {props.title}
      </text>
      <box gap={1}>
        <text fg={theme.text}>{shown()}</text>
        <Show when={overflow()}>
          <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
        </Show>
      </box>
    </box>
  )
}

// ─── Subagent: a peekable panel showing the child engine's live activity ───

function SubagentTool(props: { entry: Extract<MessageEntry, { kind: "tool" }> }) {
  const e = () => props.entry
  const running = () => e().status === "running"
  const failed = () => e().status === "error" || e().status === "invalid" || e().status === "denied"
  const progress = () => e().progress ?? []
  const [expanded, setExpanded] = createSignal(false)
  // Peep: live tail while running, full log when expanded, nothing once done+collapsed.
  const tail = () => {
    const p = progress()
    if (expanded()) return p
    if (running()) return p.slice(-6)
    return [] as readonly string[]
  }
  const task = () => {
    const t = (e().call.args as Record<string, unknown> | undefined)?.task
    return typeof t === "string" ? t : ""
  }
  const resultText = () => subagentResultText(e())

  return (
    <box
      flexDirection="column"
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      marginTop={1}
      gap={1}
      backgroundColor={theme.backgroundPanel}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={running() ? theme.info : theme.background}
      onMouseUp={() => progress().length > 0 && setExpanded((p) => !p)}
    >
      <box paddingLeft={3}>
        <Switch>
          <Match when={running()}>
            <Spinner color={theme.info}>{`${e().call.name} · subagent`}</Spinner>
          </Match>
          <Match when={true}>
            <text fg={theme.text}>
              <span style={{ fg: failed() ? theme.error : theme.success }}>▣</span> {e().call.name}
              <span style={{ fg: theme.textMuted }}> · subagent{subagentSummary(e())}</span>
            </text>
          </Match>
        </Switch>
      </box>

      <Show when={task()}>
        <text paddingLeft={3} fg={theme.textMuted}>
          ↳ {truncateLine(task(), 72)}
        </text>
      </Show>

      <Show when={tail().length > 0}>
        <box flexDirection="column" paddingLeft={3}>
          <For each={tail()}>{(line) => <text fg={theme.textMuted}>{line}</text>}</For>
        </box>
      </Show>

      <Show when={expanded() && !running() && resultText().length > 0}>
        <box paddingLeft={3}>
          <text fg={theme.text}>{resultText()}</text>
        </box>
      </Show>

      <Show when={progress().length > 0 && !running()}>
        <text paddingLeft={3} fg={theme.textMuted}>
          {expanded() ? "click to collapse" : "click to peek inside"}
        </text>
      </Show>
    </box>
  )
}

// ─── Verifier strip (Omni's critic) — styled in the inline-tool idiom ──────

function VerifierStrip(props: { verifiers: readonly VerifierEntry[] }) {
  return (
    <box flexDirection="column" paddingLeft={6}>
      <For each={props.verifiers}>
        {(v) => (
          <Switch>
            <Match when={v.status === "running"}>
              <Spinner color={theme.textMuted}>{v.name}</Spinner>
            </Match>
            <Match when={true}>
              <text fg={theme.textMuted}>
                <span style={{ fg: verifierColor(v.status) }}>{verifierIcon(v.status)}</span> {v.name}
                <Show when={v.durationMs !== undefined}>
                  <span style={{ fg: theme.textMuted }}> · {v.durationMs}ms</span>
                </Show>
                <Show when={v.status === "fail" && v.reason}>
                  <span style={{ fg: theme.error }}> {v.reason}</span>
                </Show>
                <Show when={v.status === "skip" && v.reason}>
                  <span style={{ fg: theme.textMuted }}> ({v.reason})</span>
                </Show>
              </text>
            </Match>
          </Switch>
        )}
      </For>
    </box>
  )
}

// ─── System ────────────────────────────────────────────────────────────────

function SystemMessage(props: { text: string; tone: "info" | "warn" | "error" | "dim" }) {
  return (
    <Switch>
      <Match when={props.tone === "error"}>
        <box
          border={["left"]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.error}
        >
          <text fg={theme.textMuted}>{props.text}</text>
        </box>
      </Match>
      <Match when={props.tone === "warn"}>
        <box paddingLeft={3} marginTop={1}>
          <text fg={theme.warning}>△ {props.text}</text>
        </box>
      </Match>
      <Match when={true}>
        <box paddingLeft={3} marginTop={1}>
          <text fg={theme.textMuted}>{props.text}</text>
        </box>
      </Match>
    </Switch>
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Swap markdown list markers (`-`/`*`/`+`) for real bullets — `•` at the top
 * level, `◦` when nested — since opentui's <markdown> has no list-marker
 * option. Lines inside fenced code blocks are left untouched. Two trailing
 * spaces force a hard line break so consecutive bullets don't get re-flowed
 * onto one line once they're no longer parsed as a list.
 */
function bulletize(md: string): string {
  let inFence = false
  return md
    .split("\n")
    .map((line) => {
      if (line.trimStart().startsWith("```")) {
        inFence = !inFence
        return line
      }
      if (inFence) return line
      const m = /^(\s*)[-*+]\s+(.*)$/.exec(line)
      if (!m) return line
      const indent = m[1] ?? ""
      const marker = indent.length >= 2 ? "◦" : "•"
      return `${indent}${marker} ${m[2]}  `
    })
    .join("\n")
}

function truncateLine(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim()
  return one.length > max ? one.slice(0, max) + "…" : one
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k tok` : `${n} tok`
}

/** One-line summary appended to a finished subagent header (iters/tokens, or dispatch tally). */
function subagentSummary(e: Extract<MessageEntry, { kind: "tool" }>): string {
  if (e.status === "running") return ""
  const r = e.result as Record<string, unknown> | undefined
  if (!r || typeof r !== "object") return e.status === "ok" ? "" : ` · ${e.status}`
  if (typeof r.dispatched === "number") {
    return ` · ${(r.succeeded as number) ?? 0}/${r.dispatched} ok`
  }
  const parts: string[] = []
  if (typeof r.iterations === "number") parts.push(`${r.iterations} iter${r.iterations === 1 ? "" : "s"}`)
  if (typeof r.tokensUsed === "number") parts.push(fmtTokens(r.tokensUsed))
  return parts.length ? ` · ${parts.join(" · ")}` : ""
}

/** The final text a finished subagent produced (single result, or per-agent for dispatch). */
function subagentResultText(e: Extract<MessageEntry, { kind: "tool" }>): string {
  const r = e.result as Record<string, unknown> | undefined
  if (r && typeof r === "object") {
    if (typeof r.result === "string") return r.result
    if (Array.isArray(r.results)) {
      return (r.results as Array<Record<string, unknown>>)
        .map((x) => `${String(x.agent)}: ${typeof x.result === "string" ? x.result : ""}`)
        .join("\n\n")
    }
  }
  return e.errorMessage ?? ""
}

function statusColor(s: Extract<MessageEntry, { kind: "tool" }>["status"]): RGBA {
  switch (s) {
    case "running": return theme.info
    case "ok":      return theme.success
    case "error":   return theme.error
    case "denied":  return theme.warning
    case "invalid": return theme.warning
    case "pending": return theme.textMuted
  }
}
function verifierIcon(s: VerifierEntry["status"]): string {
  switch (s) {
    case "running": return "…"
    case "pass":    return "✓"
    case "fail":    return "✗"
    case "skip":    return "○"
  }
}
function verifierColor(s: VerifierEntry["status"]): RGBA {
  switch (s) {
    case "running": return theme.info
    case "pass":    return theme.success
    case "fail":    return theme.error
    case "skip":    return theme.textMuted
  }
}
