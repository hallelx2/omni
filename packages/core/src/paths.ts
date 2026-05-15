import { homedir } from "node:os"
import { resolve, join, dirname } from "node:path"
import { existsSync } from "node:fs"

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

/**
 * Walk upward from `cwd` looking for a `.omni/` directory that marks a
 * workspace. Returns the path to that directory, or `null` if none is found.
 *
 * Useful for per-project config, commands, skills, MCP servers, and hooks
 * that override the user-level defaults at `~/.omni/`.
 */
export function workspaceOmniDir(cwd: string = process.cwd()): string | null {
  let dir = resolve(cwd)
  let prev = ""
  while (dir !== prev) {
    const candidate = join(dir, ".omni")
    if (existsSync(candidate)) return candidate
    prev = dir
    dir = dirname(dir)
  }
  return null
}

/** Resolved paths for a workspace (or `null` if there isn't one). */
export interface WorkspacePaths {
  readonly home: string
  readonly config: string
  readonly commands: string
  readonly skills: string
  readonly hooks: string
}

export function workspacePaths(cwd?: string): WorkspacePaths | null {
  const dir = workspaceOmniDir(cwd)
  if (!dir) return null
  return {
    home: dir,
    config: join(dir, "config.json"),
    commands: join(dir, "commands"),
    skills: join(dir, "skills"),
    hooks: join(dir, "hooks"),
  }
}

/** User-level versions of the per-folder paths (commands, skills, hooks). */
export function userCommandsDir(): string {
  return join(omniHome(), "commands")
}
export function userSkillsDir(): string {
  return join(omniHome(), "skills")
}
export function userHooksDir(): string {
  return join(omniHome(), "hooks")
}
