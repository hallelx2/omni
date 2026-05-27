/**
 * Frontend mirror of `@omni/server`'s desktop wire protocol + the engine event
 * union the chat renders. Kept in sync by hand with
 * `packages/server/src/desktop/protocol.ts` and `@omni/core`'s events.
 */

export interface OmniPaths {
  home: string
  config: string
  db: string
  traces: string
  memory: string
  settings: string
}

export interface Project {
  id: string
  path: string
  name: string
  modelRef?: string
  mode?: "plan" | "build"
  addedAt: number
  lastOpenedAt: number
}

export type SessionStatus = "active" | "completed" | "failed" | "aborted"

export interface UsageSummary {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  callCount: number
  costUsd?: number
}

export interface SessionSummary {
  id: string
  projectId: string
  title: string
  modelId: string
  status: SessionStatus
  messageCount: number
  createdAt: number
  updatedAt: number
  usage: UsageSummary
}

export interface ToolCall {
  id: string
  name: string
  args: unknown
}

export interface ChatMessage {
  id: string
  role: "system" | "user" | "assistant" | "tool"
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  timestamp: number
}

export interface ProviderInfo {
  id: string
  label: string
  models: string[]
  needsKey: boolean
  hasKey: boolean
  supportsBaseURL: boolean
  keyEnv?: string
}

export interface GitFile {
  path: string
  status: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
}

export interface GitStatus {
  isRepo: boolean
  branch?: string
  ahead?: number
  behind?: number
  files: GitFile[]
  clean: boolean
}

export interface GitDiff {
  path: string
  diff: string
  binary: boolean
}

export interface FileEntry {
  name: string
  path: string
  type: "dir" | "file"
}

export interface FileTree {
  dir: string
  entries: FileEntry[]
}

export interface FileContent {
  path: string
  content: string
  truncated: boolean
  tooLarge: boolean
  binary: boolean
  language: string
  bytes: number
}

// ── Config (subset of @omni/core ConfigSchema the UI edits) ──────────────────

export interface PermissionRuleConfig {
  tool: string
  decision: "allow" | "deny"
  argsInclude?: string
}

export interface OmniConfig {
  adapter?: "mock" | "mimo" | "mimo-anthropic" | "ollama" | "anthropic" | "openai" | "google"
  model?: string
  systemPrompt?: string
  maxIterations?: number
  enableReActFallback?: boolean
  providers?: {
    mimo?: { apiKey?: string; baseURL?: string }
    "mimo-anthropic"?: { apiKey?: string; baseURL?: string }
    ollama?: { baseURL?: string }
    anthropic?: { apiKey?: string; baseURL?: string }
    openai?: { apiKey?: string; baseURL?: string }
    google?: { apiKey?: string }
  }
  permissions?: {
    mode?: "allow_all" | "deny_all" | "ask" | "rules"
    autoAllow?: string[]
    denyDestructive?: boolean
    restrictToWorkspace?: boolean
    rules?: PermissionRuleConfig[]
  }
  ui?: { theme?: "dark" | "light" | "auto"; showThinking?: boolean }
  mcp?: {
    servers?: Record<
      string,
      | { kind: "stdio"; command: string; args?: string[]; env?: Record<string, string>; cwd?: string; permission?: "auto" | "ask" | "deny"; prefix?: string }
      | { kind: "http"; url: string; headers?: Record<string, string>; permission?: "auto" | "ask" | "deny"; prefix?: string }
    >
  }
  verifiers?: {
    disableBuiltins?: boolean
    typecheck?: { enabled?: boolean; command?: string; cwd?: string; timeoutMs?: number; appliesTo?: string[] }
    tests?: { enabled?: boolean; command?: string; cwd?: string; timeoutMs?: number; appliesTo?: string[] }
  }
  modes?: { default?: "plan" | "build" }
  agents?: {
    enabled?: boolean
    maxConcurrency?: number
  }
  [key: string]: unknown
}

export interface BootstrapResponse {
  version: string
  paths: OmniPaths
  projects: Project[]
  config: OmniConfig
  providers: ProviderInfo[]
  activeModel: string
}

export interface ConfigSaveResult {
  ok: boolean
  error?: string
  issues?: string[]
}

// ── Engine events (mirror of @omni/core EngineEvent) ─────────────────────────

export interface ClassifiedError {
  message: string
  category?: string
  retryable?: boolean
}

export type FinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "error" | "other" | string
export type DoneReason = "model_done" | "max_iterations" | "aborted" | "loop_detected" | "fatal_error"

export type EngineEvent =
  | { type: "engine.start"; sessionId: string; input: string }
  | { type: "engine.iteration"; iteration: number; maxIterations: number }
  | { type: "engine.done"; reason: DoneReason; usage: UsageSummary; durationMs: number }
  | { type: "engine.error"; error: ClassifiedError; fatal: boolean }
  | { type: "engine.usage"; delta: Partial<UsageSummary>; total: UsageSummary }
  | { type: "engine.warning"; category: string; message: string }
  | { type: "engine.retrying"; attempt: number; delayMs: number; reason: string }
  | { type: "engine.loop_detected"; signature: string; occurrences: number }
  | { type: "model.start"; modelId: string }
  | { type: "model.delta"; text: string }
  | { type: "model.thinking_delta"; text: string }
  | { type: "model.tool_call_start"; call: ToolCall }
  | { type: "model.tool_call_args_delta"; callId: string; argsDelta: string }
  | { type: "model.tool_call_done"; call: ToolCall }
  | { type: "model.done"; finishReason: FinishReason; usage?: Partial<UsageSummary> }
  | { type: "tool.permission_requested"; call: ToolCall; tool: { name: string; description: string } }
  | { type: "tool.permission_granted"; call: ToolCall }
  | { type: "tool.permission_denied"; call: ToolCall }
  | { type: "tool.start"; call: ToolCall }
  | { type: "tool.progress"; call: ToolCall; message: string }
  | { type: "tool.result"; call: ToolCall; result: unknown; durationMs: number }
  | { type: "tool.error"; call: ToolCall; error: ClassifiedError; durationMs: number }
  | { type: "verifier.start"; call: ToolCall; verifier: string }
  | { type: "verifier.result"; call: ToolCall; verifier: string; status: "pass" | "fail" | "skip"; reason?: string; feedback?: string; durationMs: number }
  | { type: "context.compacted"; messagesBefore: number; messagesAfter: number }
  | { type: string; [k: string]: unknown }

export type PermissionDecision = "allow" | "deny"

export type ClientMessage =
  | { type: "run"; sessionId: string; input: string }
  | { type: "abort"; sessionId: string }
  | { type: "permission_response"; requestId: string; decision: PermissionDecision }

export type ServerMessage =
  | { type: "ready"; serverVersion: string }
  | { type: "event"; sessionId: string; event: EngineEvent }
  | { type: "permission_request"; sessionId: string; requestId: string; tool: { name: string; description: string }; call: ToolCall }
  | { type: "error"; sessionId: string | null; message: string }
  | { type: "title"; sessionId: string; title: string }
