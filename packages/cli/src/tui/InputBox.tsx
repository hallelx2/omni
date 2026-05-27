import { Show, Switch, Match, createSignal, createEffect, onCleanup } from "solid-js"
import type { TextareaRenderable } from "@opentui/core"
import { theme, SplitBorder, EmptyBorder, fadeColor, CONTENT_WIDTH } from "./theme.ts"
import { Spinner } from "./Spinner.tsx"

export const SLASH_COMMANDS: ReadonlyArray<{ name: string; hint: string }> = [
  { name: "help",            hint: "list slash commands" },
  { name: "quit",            hint: "exit" },
  { name: "exit",            hint: "exit" },
  { name: "clear",           hint: "clear the screen" },
  { name: "history",         hint: "show conversation history" },
  { name: "usage",           hint: "show token usage + cost for this session" },
  { name: "sessions",        hint: "list past sessions" },
  { name: "session",         hint: "show current session id" },
  { name: "continue",        hint: "/continue <id> — resume a past session" },
  { name: "model",           hint: "show active adapter + model" },
  { name: "paths",           hint: "show ~/.omni paths" },
  { name: "profile",         hint: "show probed model profile" },
  { name: "skills",          hint: "list available skills" },
  { name: "skill",           hint: "/skill <name|off> — pin/unpin a skill" },
  { name: "mode",            hint: "/mode [plan|auto|build] — show/switch run mode" },
  { name: "plan",            hint: "switch to plan mode (read-only + planner)" },
  { name: "auto",            hint: "switch to auto mode (full tools, no permission prompts)" },
  { name: "build",           hint: "switch to build mode (full tools + critic)" },
  { name: "mcp",             hint: "/mcp [tools|restart <name>] — manage MCP servers" },
  { name: "commands",        hint: "list user-defined commands" },
  { name: "reload-commands", hint: "reload user commands" },
  { name: "ask-demo",        hint: "demo the agent question modal" },
]

/** Linear fade-in [0,1] over `ms`, opencode's prompt meta-strip animation. */
function createFadeIn(ms = 260) {
  const [alpha, setAlpha] = createSignal(0)
  const start = Date.now()
  const id = setInterval(() => {
    const t = Math.min(1, (Date.now() - start) / ms)
    setAlpha(t)
    if (t >= 1) clearInterval(id)
  }, 40)
  onCleanup(() => clearInterval(id))
  return alpha
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

/**
 * Prompt — ported from opencode's `component/prompt/index.tsx`, faithfully:
 *
 *   <box border={["left"]} chars={…, bottomLeft:"╹"}>      ← the fang
 *     <box bg=backgroundElement paddingTop=1 pl/pr=2>
 *       <textarea minHeight=1 maxHeight=6 />               ← multiline, grows
 *       <box row space-between>  meta: agent · model   right </box>
 *     </box>
 *   </box>
 *   <box height=1 border=["left"]><box border=["bottom"] char="▀"/></box>  ← undershadow
 *   <box row space-between>  spinner+interrupt / hint  ·  usage  </box>     ← status row
 *
 * opentui 0.2.12's <textarea> is uncontrolled (initialValue only). We track
 * its value through `onContentChange` and push external edits (slash-complete,
 * history, post-submit clear) back in imperatively via `ref.setText`, guarding
 * against the echo so the cursor never jumps while typing.
 */
export function InputBox(props: {
  value: string
  onChange: (v: string) => void
  onSubmit: (text: string) => void
  disabled?: boolean
  unfocused?: boolean
  running?: boolean
  modelName?: string
  provider?: string
  skillName?: string | null
  iter?: number
  maxIter?: number
  totalTokens?: number
  costUsd?: number
  interruptArmed?: boolean
}) {
  let input: TextareaRenderable | undefined
  const borderColor = () => (props.running ? theme.warning : theme.borderActive)
  const meta = createFadeIn()

  // Push external value changes into the uncontrolled textarea, skipping the
  // echo from the user's own keystrokes (plainText already matches).
  createEffect(() => {
    const v = props.value
    if (!input) return
    if (input.plainText === v) return
    input.setText(v)
  })

  const submit = () => {
    if (props.disabled) return
    // IME: double-defer so the last composed character is flushed to
    // plainText before we read it (opencode's workaround).
    setTimeout(() =>
      setTimeout(() => {
        const v = (input?.plainText ?? props.value).trim()
        if (!v) return
        props.onSubmit(v)
      }, 0),
    0)
  }

  const agentLabel = () => props.skillName ?? "omni"
  const agentColor = () => (props.skillName ? theme.accent : theme.primary)
  const usageText = () => {
    const t = props.totalTokens ?? 0
    const cost = props.costUsd ?? 0
    const parts: string[] = []
    if (t > 0) parts.push(formatTokens(t))
    if (cost > 0) parts.push(`$${cost.toFixed(4)}`)
    return parts.join(" · ")
  }

  return (
    <box flexShrink={0} marginTop={1} maxWidth={CONTENT_WIDTH}>
      {/* ── input box with left-bar fang ───────────────────────────────── */}
      <box
        border={["left"]}
        borderColor={borderColor()}
        customBorderChars={{ ...SplitBorder.customBorderChars, bottomLeft: "╹" }}
      >
        <box
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          flexShrink={0}
          backgroundColor={theme.backgroundElement}
          flexGrow={1}
        >
          <textarea
            minHeight={1}
            maxHeight={6}
            placeholder={
              props.disabled
                ? "running…   ctrl+c to interrupt"
                : "Ask anything…   ⏎ send · ⇧⏎ newline · / commands"
            }
            placeholderColor={theme.textMuted}
            textColor={theme.text}
            focusedTextColor={theme.text}
            backgroundColor={theme.backgroundElement}
            focusedBackgroundColor={theme.backgroundElement}
            focused={!props.disabled && !props.unfocused}
            // Enter / Ctrl+Enter send; Shift+Enter inserts a newline. opentui's
            // default is the inverse (Enter = newline, only Cmd+Enter submits),
            // so we override. These merge over the defaults. Shift/Ctrl+Enter
            // only differ from plain Enter on terminals with the Kitty keyboard
            // protocol (modern Windows Terminal, iTerm2, Kitty, …); elsewhere
            // Enter-to-send still works.
            keyBindings={[
              { name: "return", action: "submit" },
              { name: "return", ctrl: true, action: "submit" },
              { name: "return", shift: true, action: "newline" },
              { name: "linefeed", action: "newline" },
            ]}
            onContentChange={() => props.onChange(input?.plainText ?? "")}
            onSubmit={submit}
            onKeyDown={(e: { preventDefault(): void }) => {
              if (props.disabled) e.preventDefault()
            }}
            ref={(r: TextareaRenderable) => {
              input = r
              setTimeout(() => {
                if (!r || (r as unknown as { isDestroyed?: boolean }).isDestroyed) return
                try {
                  ;(r as unknown as { cursorColor: unknown }).cursorColor = theme.text
                } catch {
                  /* FFI not ready */
                }
              }, 0)
            }}
          />

          {/* meta strip: agent · model · provider (left) / right slot */}
          <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1} justifyContent="space-between">
            <box flexDirection="row" gap={1}>
              <text fg={fadeColor(agentColor(), meta())}>{agentLabel()}</text>
              <Show when={props.modelName}>
                <text fg={fadeColor(theme.textMuted, meta())}>·</text>
                <text fg={fadeColor(theme.text, meta())}>{props.modelName}</text>
              </Show>
              <Show when={props.provider}>
                <text fg={fadeColor(theme.textMuted, meta())}>{props.provider}</text>
              </Show>
            </box>
          </box>
        </box>
      </box>

      {/* ── ▀ half-block undershadow (elevation under the input) ───────── */}
      <box
        height={1}
        border={["left"]}
        borderColor={borderColor()}
        customBorderChars={{ ...EmptyBorder, vertical: "╹" }}
      >
        <box
          height={1}
          border={["bottom"]}
          borderColor={theme.backgroundElement}
          customBorderChars={{ ...EmptyBorder, horizontal: "▀" }}
        />
      </box>

      {/* ── status / hint row, directly under the prompt ──────────────── */}
      <box width="100%" flexDirection="row" justifyContent="space-between">
        <Switch>
          <Match when={props.running}>
            <box flexDirection="row" gap={1} alignItems="center">
              <box marginLeft={1}>
                <Spinner color={theme.warning} />
              </box>
              <Show when={(props.maxIter ?? 0) > 0}>
                <text fg={theme.textMuted}>
                  iter {props.iter ?? 0}/{props.maxIter}
                </text>
              </Show>
              <text fg={props.interruptArmed ? theme.primary : theme.text}>
                esc{" "}
                <span style={{ fg: props.interruptArmed ? theme.primary : theme.textMuted }}>
                  {props.interruptArmed ? "again to interrupt" : "interrupt"}
                </span>
              </text>
            </box>
          </Match>
          <Match when={true}>
            <text fg={theme.textMuted}>{props.disabled ? "" : ""}</text>
          </Match>
        </Switch>

        <Show when={!props.running}>
          <box gap={2} flexDirection="row">
            <Show when={usageText()}>
              <text fg={theme.textMuted} wrapMode="none">
                {usageText()}
              </text>
            </Show>
            <text fg={theme.text}>
              / <span style={{ fg: theme.textMuted }}>commands</span>
            </text>
            <text fg={theme.text}>
              ctrl+b <span style={{ fg: theme.textMuted }}>stats</span>
            </text>
          </box>
        </Show>
      </box>
    </box>
  )
}
