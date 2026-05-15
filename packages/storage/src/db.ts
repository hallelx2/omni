import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"

/**
 * Versioned schema migrations. Each entry is the SQL to bring the schema
 * from version N-1 to version N. They run in array order on every open;
 * the current version is tracked in the `_migrations` table.
 */
export const MIGRATIONS: readonly string[] = [
  // 1 — sessions + messages
  `
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      model_id      TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'active',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      meta_json     TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role          TEXT NOT NULL,
      content       TEXT NOT NULL,
      tool_calls    TEXT,        -- JSON
      tool_call_id  TEXT,
      metadata      TEXT,        -- JSON
      timestamp     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);
  `,

  // 2 — events (trace), audit_log
  `
    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      t           INTEGER NOT NULL,
      type        TEXT NOT NULL,
      data_json   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, t);

    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT,
      tool        TEXT NOT NULL,
      decision    TEXT NOT NULL,
      args_json   TEXT NOT NULL,
      timestamp   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id, timestamp);
  `,

  // 3 — model_profiles, prompt_variants, settings
  `
    CREATE TABLE IF NOT EXISTS model_profiles (
      model_id      TEXT PRIMARY KEY,
      profile_json  TEXT NOT NULL,
      probed_at     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_variants (
      id            TEXT PRIMARY KEY,
      text          TEXT NOT NULL,
      parent        TEXT,
      trials        INTEGER NOT NULL DEFAULT 0,
      success_score REAL NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `,

  // 4 — vector_memory for embedding-based recall
  `
    CREATE TABLE IF NOT EXISTS vector_memory (
      id          TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,
      text        TEXT NOT NULL,
      tags_json   TEXT,
      embedding   BLOB NOT NULL,  -- Float32Array bytes
      dim         INTEGER NOT NULL,
      source      TEXT,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vector_memory_kind ON vector_memory(kind);
    CREATE INDEX IF NOT EXISTS idx_vector_memory_created ON vector_memory(created_at);
  `,
]

/** Lightweight wrapper around bun:sqlite with versioned migrations. */
export class Storage {
  readonly db: Database
  constructor(private readonly path: string = ":memory:") {
    if (path !== ":memory:") {
      mkdirSync(dirname(resolve(path)), { recursive: true })
    }
    this.db = new Database(path)
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA foreign_keys = ON")
    this._migrate()
  }

  close(): void {
    this.db.close()
  }

  schemaVersion(): number {
    const row = this.db
      .query("SELECT MAX(version) AS v FROM _migrations")
      .get() as { v: number | null } | null
    return row?.v ?? 0
  }

  private _migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version    INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `)
    const current = this.schemaVersion()
    for (let i = current; i < MIGRATIONS.length; i++) {
      const sql = MIGRATIONS[i]!
      this.db.transaction(() => {
        this.db.exec(sql)
        this.db
          .query("INSERT INTO _migrations (version, applied_at) VALUES (?, ?)")
          .run(i + 1, Date.now())
      })()
    }
  }
}
