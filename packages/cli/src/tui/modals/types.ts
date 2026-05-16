/**
 * Modal-stack types and queue.
 *
 * Modals are *promise-bound*: you call `push(spec)` and get back a
 * `Promise<T>` that resolves when the user picks an option (or cancels).
 * The store renders only the top-of-stack modal — earlier modals stay
 * suspended until the top one resolves.
 *
 * Why a stack rather than a singleton: an agent can ask a clarifying
 * question while it's waiting on a permission decision; a file picker
 * can pop while a permission modal is still up. The stack handles all of
 * these without races.
 */

/** Resolves with `null` when the user cancels (esc). */
export type ModalSpec =
  | PermissionModalSpec
  | QuestionModalSpec
  | ConfirmModalSpec
  | HelpModalSpec
  | SessionPickerModalSpec
  | import("./ToolDetailModal.tsx").ToolDetailModalSpec

export interface ModalCommon<T> {
  /** Unique id (used by Solid's keyed rendering). */
  readonly id: string
  /** Resolver attached by the queue. The component calls this on choice / cancel. */
  resolve(value: T | null): void
}

// ─── Permission ───────────────────────────────────────────────────────────

export type PermissionDecision = "allow" | "allow-always" | "deny" | "deny-always"

export interface PermissionModalSpec extends ModalCommon<PermissionDecision> {
  readonly kind: "permission"
  readonly toolName: string
  readonly toolDescription: string
  readonly argsPreview: string
  /** Optional: a short risk note from `looksDestructive` etc. */
  readonly risk?: string | null
}

// ─── Question (agent → user) ──────────────────────────────────────────────

export interface QuestionOption {
  /** Single-char key shortcut. */
  readonly key: string
  /** Visible label. */
  readonly label: string
  /** Description shown below the label when focused. */
  readonly description?: string
  /** Value returned by resolve(). */
  readonly value: string
}

export interface QuestionModalSpec extends ModalCommon<string> {
  readonly kind: "question"
  /** Header text (one short sentence). */
  readonly question: string
  /** Optional explanation under the question. */
  readonly context?: string
  readonly options: readonly QuestionOption[]
  /** Allow free-text entry via `other`. Default true. */
  readonly allowOther?: boolean
}

// ─── Confirm ──────────────────────────────────────────────────────────────

export interface ConfirmModalSpec extends ModalCommon<boolean> {
  readonly kind: "confirm"
  readonly title: string
  readonly body?: string
  readonly confirmLabel?: string
  readonly cancelLabel?: string
  /** Default focus on the confirm button. Default true. */
  readonly confirmByDefault?: boolean
}

// ─── Help ─────────────────────────────────────────────────────────────────

export interface HelpModalSpec extends ModalCommon<void> {
  readonly kind: "help"
}

// ─── Session picker ───────────────────────────────────────────────────────

export interface SessionRow {
  readonly id: string
  readonly model: string
  readonly status: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly turns: number
}

export interface SessionPickerModalSpec extends ModalCommon<string> {
  readonly kind: "session-picker"
  readonly rows: readonly SessionRow[]
  readonly currentId: string
}
