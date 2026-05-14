/**
 * `@omni/storage` — bun:sqlite persistence for sessions, messages, events,
 * audit logs, model profiles, prompt variants, and settings.
 *
 * @example
 * ```ts
 * import { Storage, SessionsRepo, MessagesRepo } from "@omni/storage"
 * const store = new Storage(".omni/db.sqlite")
 * const sessions = new SessionsRepo(store)
 * const messages = new MessagesRepo(store)
 * sessions.create("01HX...", "mimo-v2.5-pro")
 * ```
 */
export { Storage, MIGRATIONS } from "./db.ts"
export { SessionsRepo } from "./sessions.ts"
export type { SessionRow, SessionStatus } from "./sessions.ts"
export { MessagesRepo } from "./messages.ts"
export type { StoredMessage } from "./messages.ts"
export { EventsRepo } from "./events.ts"
export type { StoredEvent } from "./events.ts"
export { ProfilesRepo } from "./profiles.ts"
export { VariantsRepo } from "./variants.ts"
export type { StoredVariant } from "./variants.ts"
export { AuditRepo } from "./audit.ts"
export type { StoredAudit } from "./audit.ts"
export { SettingsRepo } from "./settings.ts"
