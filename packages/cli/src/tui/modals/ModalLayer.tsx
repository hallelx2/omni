import { Show } from "solid-js"
import type { ModalQueue } from "./queue.ts"
import { PermissionModal } from "./PermissionModal.tsx"
import { AskQuestionModal } from "./AskQuestionModal.tsx"
import { ConfirmModal } from "./ConfirmModal.tsx"
import { HelpOverlay } from "./HelpOverlay.tsx"
import { SessionPicker } from "./SessionPicker.tsx"
import { ToolDetailModal } from "./ToolDetailModal.tsx"
import type { ModalSpec } from "./types.ts"

/**
 * Renders ONLY the topmost modal — earlier ones stay queued. The whole
 * thing is absolutely positioned over the rest of the App.
 */
export function ModalLayer(props: { queue: ModalQueue }) {
  return (
    <Show when={props.queue.top()}>
      <Dispatch spec={props.queue.top()!} />
    </Show>
  )
}

function Dispatch(props: { spec: ModalSpec }) {
  switch (props.spec.kind) {
    case "permission":     return <PermissionModal spec={props.spec} />
    case "question":       return <AskQuestionModal spec={props.spec} />
    case "confirm":        return <ConfirmModal spec={props.spec} />
    case "help":           return <HelpOverlay spec={props.spec} />
    case "session-picker": return <SessionPicker spec={props.spec} />
    case "tool-detail":    return <ToolDetailModal spec={props.spec} />
  }
}
