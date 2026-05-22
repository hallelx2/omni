import { theme, PromptFangChars, EmptyBorderChars } from "./theme.ts"

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
  { name: "mcp",             hint: "/mcp [tools|restart <name>] — manage MCP servers" },
  { name: "commands",        hint: "list user-defined commands" },
  { name: "reload-commands", hint: "reload user commands" },
  { name: "ask-demo",        hint: "demo the agent question modal" },
]

/**
 * Prompt — opencode pattern, faithfully. A `border=["left"]` wrapper
 * with a `╹` fang at bottom-left, an inner backgroundElement-filled box
 * holding a multi-line `<textarea>` (min 1, max 6 rows), and a metadata
 * strip (model + provider left, optional right content). Below it, a
 * height-1 box continues the left bar as the fang's tail.
 *
 * All layout via top-level props — no `style` objects (matches the
 * working opencode idiom and avoids the reconciler quirks we hit).
 */
export function InputBox(props: {
  value: string
  onChange: (v: string) => void
  onSubmit: (text: string) => void
  disabled?: boolean
  unfocused?: boolean
  running?: boolean
  modelName?: string
}) {
  const borderColor = () => (props.running ? theme.warning : theme.borderActive)

  // opentui's <input> is single-line; we use it here for reliability with
  // the value/onInput controlled pattern. (textarea is uncontrolled via
  // initialValue, which fights our slash-complete inserts.)
  const submit = (v: string) => {
    const trimmed = v.trim()
    if (!trimmed) return
    props.onSubmit(trimmed)
  }

  return (
    <box flexShrink={0} marginTop={1}>
      <box border={["left"]} borderColor={borderColor()} customBorderChars={PromptFangChars}>
        <box
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          flexShrink={0}
          backgroundColor={theme.backgroundElement}
          flexGrow={1}
        >
          <input
            value={props.value}
            placeholder={
              props.disabled ? "running…  ctrl-c to interrupt" : "Ask anything…   / for commands"
            }
            placeholderColor={theme.textMuted}
            focusedBackgroundColor={theme.backgroundElement}
            cursorColor={theme.text}
            onInput={props.onChange}
            onSubmit={submit as never}
            focused={!props.disabled && !props.unfocused}
          />
          <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1} justifyContent="space-between">
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>{props.modelName ?? "model"}</text>
            </box>
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted}>ctrl+b sidebar · / commands · ctrl+c quit</text>
            </box>
          </box>
        </box>
      </box>
      <box height={1} border={["left"]} borderColor={borderColor()} customBorderChars={EmptyBorderChars} />
    </box>
  )
}
