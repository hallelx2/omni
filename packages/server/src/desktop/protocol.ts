/**
 * Wire protocol for the Omni desktop app (`@omni/desktop`).
 *
 * The desktop frontend talks to a Bun sidecar that runs this server. Two
 * channels:
 *
 *   • REST (JSON over HTTP, under `/api`) — projects, sessions, config,
 *     providers, git, files. CRUD-shaped, request/response.
 *   • WebSocket (`/ws`) — a single multiplexed socket carrying live engine
 *     runs for every session, plus interactive permission prompts.
 *
 * These types are the source of truth; the frontend keeps a hand-written
 * mirror in `ui/src/lib/protocol.ts`. Keep them in sync.
 */
import type { EngineEvent, PermissionDecision, ToolCall, Config, OmniPaths } from "@omni/core"

// ── Domain objects ───────────────────────────────────────────────────────────

/** A project is a folder the user has opened. Persisted to `~/.omni/desktop.json`. */
export interface Project {
  readonly id: string
  /** Absolute path to the project root. */
  readonly path: string
  /** Display name (defaults to the folder basename). */
  readonly name: string
  /** Optional per-project model override, "provider:model" (e.g. "anthropic:claude-sonnet-4-6"). */
  readonly modelRef?: string
  /** Optional per-project run mode override. */
  readonly mode?: "plan" | "build"
  /** Unix millis the project was added. */
  readonly addedAt: number
  /** Unix millis it was last opened. */
  readonly lastOpenedAt: number
}

export interface SessionSummary {
  readonly id: string
  readonly projectId: string
  readonly title: string
  readonly modelId: string
  readonly status: "active" | "completed" | "failed" | "aborted"
  readonly messageCount: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly usage: UsageSummary
}

export interface UsageSummary {
  readonly promptTokens: number
  readonly completionTokens: number
  readonly totalTokens: number
  readonly callCount: number
  readonly costUsd?: number
}

/** A persisted message, flattened for the UI. */
export interface ChatMessage {
  readonly id: string
  readonly role: "system" | "user" | "assistant" | "tool"
  readonly content: string
  readonly toolCalls?: readonly ToolCall[]
  readonly toolCallId?: string
  readonly timestamp: number
}

export interface ProviderInfo {
  readonly id: string
  readonly label: string
  readonly models: readonly string[]
  /** Whether the provider requires an API key. */
  readonly needsKey: boolean
  /** Whether a key/credential is currently resolvable (env or config). */
  readonly hasKey: boolean
  /** Whether a custom base URL is meaningful (OpenAI-compatible, self-hosted). */
  readonly supportsBaseURL: boolean
  /** The env var checked for the key, if any. */
  readonly keyEnv?: string
}

// ── Git + files ──────────────────────────────────────────────────────────────

export interface GitFile {
  readonly path: string
  /** Two-letter porcelain status, e.g. " M", "??", "A ". */
  readonly status: string
  readonly staged: boolean
  readonly unstaged: boolean
  readonly untracked: boolean
}

export interface GitStatus {
  readonly isRepo: boolean
  readonly branch?: string
  readonly ahead?: number
  readonly behind?: number
  readonly files: readonly GitFile[]
  readonly clean: boolean
}

export interface GitDiff {
  readonly path: string
  readonly diff: string
  readonly binary: boolean
}

export interface FileEntry {
  readonly name: string
  /** Path relative to the project root, posix-style. */
  readonly path: string
  readonly type: "dir" | "file"
}

export interface FileTree {
  readonly dir: string
  readonly entries: readonly FileEntry[]
}

export interface FileContent {
  readonly path: string
  readonly content: string
  readonly truncated: boolean
  readonly tooLarge: boolean
  readonly binary: boolean
  readonly language: string
  readonly bytes: number
}

// ── REST payloads ────────────────────────────────────────────────────────────

export interface BootstrapResponse {
  readonly version: string
  readonly paths: OmniPaths
  readonly projects: readonly Project[]
  readonly config: Config
  readonly providers: readonly ProviderInfo[]
  readonly activeModel: string
}

export interface ConfigSaveResult {
  readonly ok: boolean
  readonly error?: string
  readonly issues?: readonly string[]
}

// ── WebSocket: client → server ───────────────────────────────────────────────

export type ClientMessage =
  | { readonly type: "run"; readonly sessionId: string; readonly input: string }
  | { readonly type: "abort"; readonly sessionId: string }
  | {
      readonly type: "permission_response"
      readonly requestId: string
      readonly decision: PermissionDecision
    }

// ── WebSocket: server → client ───────────────────────────────────────────────

export type ServerMessage =
  | { readonly type: "ready"; readonly serverVersion: string }
  | { readonly type: "event"; readonly sessionId: string; readonly event: EngineEvent }
  | {
      readonly type: "permission_request"
      readonly sessionId: string
      readonly requestId: string
      readonly tool: { readonly name: string; readonly description: string }
      readonly call: ToolCall
    }
  | { readonly type: "error"; readonly sessionId: string | null; readonly message: string }
  | { readonly type: "title"; readonly sessionId: string; readonly title: string }
