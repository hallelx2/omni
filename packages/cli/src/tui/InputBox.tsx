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
]

export function InputBox(props: {
  value: string
  onChange: (v: string) => void
  onSubmit: (text: string) => void
  disabled?: boolean
  /** Disable input focus (e.g. when a modal is active). */
  unfocused?: boolean
}) {
  const submit = (v: string) => {
    const trimmed = v.trim()
    if (!trimmed) return
    props.onSubmit(trimmed)
  }

  const lineCount = () => Math.min(6, Math.max(1, props.value.split("\n").length))
  const height = () => lineCount() + 2 // 2 lines for top + bottom border

  return (
    <box
      style={{
        borderStyle: "rounded",
        borderColor: props.disabled ? "#334155" : "#475569",
        height: height(),
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <input
        value={props.value}
        placeholder={
          props.disabled
            ? "running…  (ctrl-c to abort)"
            : "› type a message · / for commands · ⏎ send"
        }
        onInput={props.onChange}
        // opentui's InputProps types onSubmit as an intersection of two
        // overloads (SubmitEvent and string) — at runtime it's always the
        // string value. Cast keeps the call site readable.
        onSubmit={submit as never}
        focused={!props.disabled && !props.unfocused}
      />
    </box>
  )
}
