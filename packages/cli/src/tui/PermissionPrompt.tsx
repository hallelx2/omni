import { Show, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { SplitBorder, theme } from "./theme.ts"
import { toolIcon, toolLabel } from "./tool-format.ts"

export type PermissionDecision = "allow" | "allow-always" | "deny" | "deny-always"

export interface PermissionRequest {
  readonly toolName: string
  readonly toolDescription?: string
  readonly args: unknown
  readonly risk: string | null
  readonly resolve: (decision: PermissionDecision) => void
}

/**
 * Permission controller — a surface concern that lives outside the engine
 * (like toasts). The ask-gate calls `request(...)` and awaits the user's
 * decision; the inline {@link PermissionPrompt} renders the pending one and
 * resolves it. Created before bootstrap so the ask-handler can close over it.
 */
export function createPermissionController() {
  const [pending, setPending] = createSignal<PermissionRequest | null>(null)
  function request(req: Omit<PermissionRequest, "resolve">): Promise<PermissionDecision> {
    return new Promise((resolve) => {
      setPending({
        ...req,
        resolve: (d) => {
          setPending(null)
          resolve(d)
        },
      })
    })
  }
  return { pending, request }
}

export type PermissionController = ReturnType<typeof createPermissionController>

/**
 * Inline permission prompt — opencode's pattern: rendered in the chat
 * column just above the input (not a centred modal). Tool-grounded keys:
 *   y / ⏎  allow once   ·   a  allow always   ·   n / esc  deny   ·   d  deny always
 */
export function PermissionPrompt(props: { request: PermissionRequest }) {
  useKeyboard((ev) => {
    if (ev.name === "y" || ev.name === "return" || ev.name === "enter") props.request.resolve("allow")
    else if (ev.name === "a") props.request.resolve("allow-always")
    else if (ev.name === "n" || ev.name === "escape") props.request.resolve("deny")
    else if (ev.name === "d") props.request.resolve("deny-always")
  })

  const label = () => toolLabel(props.request.toolName, props.request.args as Record<string, unknown>)

  return (
    <box
      flexShrink={0}
      marginTop={1}
      border={["left"]}
      borderColor={theme.warning}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box
        backgroundColor={theme.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        flexShrink={0}
      >
        <box flexDirection="row" gap={1}>
          <text fg={theme.warning}>⚠ permission</text>
          <text fg={theme.textMuted}>{props.request.toolName}</text>
        </box>
        <Show when={props.request.toolDescription}>
          <text fg={theme.textMuted}>{props.request.toolDescription}</text>
        </Show>

        <box marginTop={1}>
          <text fg={theme.text}>
            <span style={{ fg: theme.textMuted }}>{toolIcon(props.request.toolName)}</span> {label()}
          </text>
        </box>

        <Show when={props.request.risk}>
          <box marginTop={1}>
            <text fg={theme.warning}>△ {props.request.risk}</text>
          </box>
        </Show>

        <box marginTop={1} flexDirection="row">
          <Key k="y" label="allow once" tone={theme.success} />
          <Sep />
          <Key k="a" label="allow always" tone={theme.success} />
          <Sep />
          <Key k="n" label="deny" tone={theme.error} />
          <Sep />
          <Key k="d" label="deny always" tone={theme.error} />
        </box>
        <text fg={theme.textMuted}>⏎ allow once · esc to deny</text>
      </box>
    </box>
  )
}

function Key(props: { k: string; label: string; tone: import("@opentui/core").RGBA }) {
  return (
    <box flexDirection="row">
      <text fg={props.tone}>{props.k}</text>
      <text fg={theme.textMuted}> {props.label}</text>
    </box>
  )
}
function Sep() {
  return <text fg={theme.textMuted}>{"   ·   "}</text>
}
