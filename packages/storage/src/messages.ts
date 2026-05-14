import type { Storage } from "./db.ts"

export interface StoredMessage {
  readonly id: string
  readonly session_id: string
  readonly role: "system" | "user" | "assistant" | "tool"
  readonly content: string
  readonly tool_calls?: readonly { id: string; name: string; args: unknown }[]
  readonly tool_call_id?: string
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly timestamp: number
}

export class MessagesRepo {
  constructor(private readonly store: Storage) {}

  append(msg: StoredMessage): void {
    this.store.db
      .query(
        `INSERT INTO messages (id, session_id, role, content, tool_calls, tool_call_id, metadata, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        msg.id,
        msg.session_id,
        msg.role,
        msg.content,
        msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
        msg.tool_call_id ?? null,
        msg.metadata ? JSON.stringify(msg.metadata) : null,
        msg.timestamp,
      )
  }

  bySession(sessionId: string): readonly StoredMessage[] {
    const rows = this.store.db
      .query("SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC")
      .all(sessionId) as Array<{
      id: string
      session_id: string
      role: StoredMessage["role"]
      content: string
      tool_calls: string | null
      tool_call_id: string | null
      metadata: string | null
      timestamp: number
    }>
    return rows.map((r) => ({
      id: r.id,
      session_id: r.session_id,
      role: r.role,
      content: r.content,
      tool_calls: r.tool_calls ? JSON.parse(r.tool_calls) : undefined,
      tool_call_id: r.tool_call_id ?? undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      timestamp: r.timestamp,
    }))
  }

  countBySession(sessionId: string): number {
    const row = this.store.db
      .query("SELECT COUNT(*) AS n FROM messages WHERE session_id = ?")
      .get(sessionId) as { n: number }
    return row.n
  }
}
