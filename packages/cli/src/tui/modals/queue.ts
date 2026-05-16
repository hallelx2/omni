import { createSignal } from "solid-js"
import type {
  ModalSpec,
  PermissionModalSpec,
  PermissionDecision,
  QuestionModalSpec,
  ConfirmModalSpec,
  HelpModalSpec,
  SessionPickerModalSpec,
} from "./types.ts"

/**
 * Promise-bound modal stack. UI reads `stack()` to render the top entry.
 * Drivers call `push(...)` and await the returned promise.
 *
 * The `push` function is overloaded per kind so callers get a
 * kind-specific return type without having to spell the full ModalSpec.
 */
export function createModalQueue() {
  const [stack, setStack] = createSignal<readonly ModalSpec[]>([], { equals: false })

  function push(spec: Omit<PermissionModalSpec, "id" | "resolve">): Promise<PermissionDecision | null>
  function push(spec: Omit<QuestionModalSpec, "id" | "resolve">): Promise<string | null>
  function push(spec: Omit<ConfirmModalSpec, "id" | "resolve">): Promise<boolean | null>
  function push(spec: Omit<HelpModalSpec, "id" | "resolve">): Promise<void | null>
  function push(spec: Omit<SessionPickerModalSpec, "id" | "resolve">): Promise<string | null>
  function push(spec: Omit<ModalSpec, "id" | "resolve">): Promise<unknown> {
    return new Promise((res) => {
      const id = `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      const entry: ModalSpec = {
        ...(spec as ModalSpec),
        id,
        resolve: (value: unknown) => {
          setStack((s) => s.filter((m) => m.id !== id))
          res(value)
        },
      } as ModalSpec
      setStack((s) => [...s, entry])
    })
  }

  function top(): ModalSpec | null {
    const s = stack()
    return s.length === 0 ? null : s[s.length - 1]!
  }

  function dismissTop(): void {
    const t = top()
    if (t) t.resolve(null as never)
  }

  return { stack, top, push, dismissTop }
}

export type ModalQueue = ReturnType<typeof createModalQueue>
