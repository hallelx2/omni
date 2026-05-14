import { homedir } from "node:os"
import { resolve, join } from "node:path"

/**
 * Resolves Omni's home directory, where per-user state lives across sessions:
 *
 *   ~/.omni/
 *     config.json    user preferences (default adapter, model, permissions, etc.)
 *     db.sqlite      bun:sqlite database (sessions, messages, events, audit, profiles)
 *     traces/        per-session JSONL trace files
 *     memory.json    long-term memory entries
 *     settings.json  surface-specific settings (UI theme, etc.)
 *
 * Honored env overrides:
 *   - `OMNI_HOME`       — overrides the whole home directory
 *   - `OMNI_DB`         — overrides just the SQLite path
 *   - `OMNI_TRACES`     — overrides the traces directory
 *   - `OMNI_MEMORY`     — overrides the memory file path
 *   - `OMNI_CONFIG`     — overrides the config.json path
 */
export function omniHome(): string {
  if (process.env.OMNI_HOME) return resolve(process.env.OMNI_HOME)
  return resolve(homedir(), ".omni")
}

export function omniConfigPath(): string {
  return process.env.OMNI_CONFIG ? resolve(process.env.OMNI_CONFIG) : join(omniHome(), "config.json")
}

export function omniDbPath(): string {
  return process.env.OMNI_DB ? resolve(process.env.OMNI_DB) : join(omniHome(), "db.sqlite")
}

export function omniTracesDir(): string {
  return process.env.OMNI_TRACES ? resolve(process.env.OMNI_TRACES) : join(omniHome(), "traces")
}

export function omniMemoryPath(): string {
  return process.env.OMNI_MEMORY ? resolve(process.env.OMNI_MEMORY) : join(omniHome(), "memory.json")
}

export function omniSettingsPath(): string {
  return join(omniHome(), "settings.json")
}

/**
 * Snapshot of all resolved paths — useful for diagnostics (e.g. a CLI
 * `/paths` command) and for ensuring the home directory exists.
 */
export interface OmniPaths {
  readonly home: string
  readonly config: string
  readonly db: string
  readonly traces: string
  readonly memory: string
  readonly settings: string
}

export function omniPaths(): OmniPaths {
  return {
    home: omniHome(),
    config: omniConfigPath(),
    db: omniDbPath(),
    traces: omniTracesDir(),
    memory: omniMemoryPath(),
    settings: omniSettingsPath(),
  }
}
