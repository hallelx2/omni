import { createSignal, Show } from "solid-js"

export function InputBox(props: {
  onSubmit: (text: string) => void
  disabled?: boolean
  history: readonly string[]
}) {
  const [value, setValue] = createSignal("")

  const submit = (v: string) => {
    const trimmed = v.trim()
    if (!trimmed) return
    props.onSubmit(trimmed)
    setValue("")
  }

  return (
    <box
      style={{
        flexDirection: "column",
        borderStyle: "rounded",
        borderColor: props.disabled ? "#334155" : "#475569",
        height: 3,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <input
        value={value()}
        placeholder={
          props.disabled
            ? "running…  (ctrl-c to abort)"
            : "› type a message · / for commands · ⏎ send"
        }
        onInput={setValue}
        // opentui's InputProps types onSubmit as an intersection of two
        // overloads (SubmitEvent and string) — at runtime it's always the
        // string value. Cast keeps the call site readable.
        onSubmit={submit as never}
        focused={!props.disabled}
      />
      <Show when={value().startsWith("/")}>
        <text fg="#64748b">{slashHint(value())}</text>
      </Show>
    </box>
  )
}

function slashHint(input: string): string {
  const name = input.slice(1).split(/\s+/)[0]?.toLowerCase() ?? ""
  const cmd = COMMAND_HINTS.find((c) => c.name.startsWith(name))
  if (!cmd) return `unknown command. try: ${COMMAND_HINTS.slice(0, 6).map((c) => "/" + c.name).join("  ")}`
  return `/${cmd.name}  —  ${cmd.hint}`
}

const COMMAND_HINTS: ReadonlyArray<{ name: string; hint: string }> = [
  { name: "help",       hint: "list slash commands" },
  { name: "quit",       hint: "exit omni" },
  { name: "exit",       hint: "exit omni" },
  { name: "history",    hint: "show conversation history" },
  { name: "usage",      hint: "show token usage + cost for this session" },
  { name: "sessions",   hint: "list past sessions" },
  { name: "session",    hint: "show current session id" },
  { name: "continue",   hint: "/continue <id> — resume a past session" },
  { name: "model",      hint: "show active adapter + model" },
  { name: "paths",      hint: "show ~/.omni paths" },
  { name: "profile",    hint: "show probed model profile" },
  { name: "skills",     hint: "list available skills" },
  { name: "skill",      hint: "/skill <name|off> — pin/unpin a skill" },
  { name: "mcp",        hint: "/mcp [tools|restart <name>] — manage MCP servers" },
  { name: "commands",   hint: "list user-defined commands" },
  { name: "reload-commands", hint: "reload user commands" },
  { name: "clear",      hint: "clear the screen" },
]
