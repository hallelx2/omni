import { theme, PromptBorder } from "./theme.ts"

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
 * Prompt — opencode pattern. Left-bar border (`┃`) only, with a `╹`
 * fang at the bottom-left as a visual anchor. Background element fill.
 * Below the input row, a metadata strip in `theme.textMuted` shows the
 * active model and a shortcut hint.
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
  const submit = (v: string) => {
    const trimmed = v.trim()
    if (!trimmed) return
    props.onSubmit(trimmed)
  }

  return (
    <box style={{ flexDirection: "column", marginTop: 1, marginBottom: 1 }}>
      {/* Input itself, with SplitBorder on left */}
      <box
        style={{
          flexDirection: "column",
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 1,
          paddingBottom: 1,
          backgroundColor: theme.backgroundElement,
          border: PromptBorder.sides as never,
          borderColor: props.running ? theme.warning : theme.borderActive,
          customBorderChars: PromptBorder.chars as never,
        }}
      >
        <input
          value={props.value}
          placeholder={
            props.disabled
              ? "running…  (ctrl-c to interrupt)"
              : "Ask anything…   / for commands"
          }
          placeholderColor={theme.textMuted}
          onInput={props.onChange}
          // opentui's InputProps types onSubmit as an overload intersection
          // (SubmitEvent and string). At runtime it's always the string.
          onSubmit={submit as never}
          focused={!props.disabled && !props.unfocused}
        />
      </box>

      {/* Metadata strip below the prompt — model + shortcuts */}
      <box style={{ flexDirection: "row", paddingLeft: 1, paddingRight: 1, marginTop: 0 }}>
        <text fg={theme.textMuted}>
          {props.modelName ?? "model"}
        </text>
        <box style={{ flexGrow: 1 }} />
        <text fg={theme.text}>ctrl+b</text>
        <text fg={theme.textMuted}> sidebar  </text>
        <text fg={theme.text}>ctrl+p</text>
        <text fg={theme.textMuted}> commands  </text>
        <text fg={theme.text}>ctrl+c</text>
        <text fg={theme.textMuted}> quit</text>
      </box>
    </box>
  )
}
