/**
 * `@omni/core` — the engine, types, and extension contracts.
 *
 * Three tiers of exports:
 *
 * 1. **Core API** — what 90% of consumers need.
 * 2. **Extension contracts** — implement these to plug in providers, tools,
 *    permission strategies, or context strategies.
 * 3. **Utilities** — small primitives reused across adapters/tools.
 *
 * For type-only imports prefer `@omni/core/types`.
 */

// ─── 1. Core API ───────────────────────────────────────────────────────────

export { Engine } from "./engine.ts"
export type { EngineConfig, RunOptions } from "./engine.ts"

export { asSubagent } from "./subagent.ts"
export type { SubagentConfig, SubagentResult } from "./subagent.ts"

export {
  runPreToolUse,
  runPostToolUse,
  runPreModel,
  runOnError,
  runOnSessionStart,
  runOnSessionEnd,
} from "./hooks.ts"
export type {
  HookModule,
  HookEvent,
  PreToolUseResult,
  PostToolUseResult,
  PreModelResult,
  OnErrorResult,
} from "./hooks.ts"

export {
  AllowAllPermissions,
  DenyAllPermissions,
  StaticPermissions,
  AskPermissions,
  RuleBasedPermissions,
  AuditingPermissions,
  looksDestructive,
} from "./permissions.ts"
export type { PermissionRule } from "./permissions.ts"

export {
  InMemoryAuditLog,
  ConsoleAuditLog,
  NullAuditLog,
} from "./audit.ts"
export type { AuditLog, AuditRecord } from "./audit.ts"

export {
  ContextManager,
  SlidingWindowStrategy,
  TokenBudgetStrategy,
  chunkToolResult,
  estimateTokens,
} from "./context.ts"
export type { FitResult } from "./context.ts"

export { TiktokenTokenizer, CharEstimator, defaultTokenizer } from "./tokenizer.ts"
export type { Tokenizer } from "./tokenizer.ts"

// ─── 2. Extension contracts ────────────────────────────────────────────────

// Re-exported as values for `implements` and as types where appropriate.
export type {
  ModelAdapter,
  ModelCapabilities,
  ModelEvent,
  CompleteParams,
  FinishReason,
  Tool,
  ToolMeta,
  ToolContext,
  ToolPermission,
  ToolSchema,
  ToolCall,
  Message,
  Role,
  TokenUsage,
  UsageDelta,
  CumulativeUsage,
  SessionSnapshot,
} from "./types.ts"

export type { PermissionGate, PermissionDecision, AskHandler } from "./permissions.ts"
export type { ContextStrategy, ContextLimits } from "./context.ts"
export type { EngineEvent, DoneReason } from "./events.ts"

// ─── 3. Utilities (helpful when authoring adapters/tools) ──────────────────

export { validateToolCall, toToolSchema, parseReActFallback } from "./validator.ts"
export type { ValidationResult } from "./validator.ts"

export { classifyError } from "./util/errors.ts"
export type { ClassifiedError, ErrorCategory, ClassifyHints } from "./util/errors.ts"

export { AsyncQueue } from "./util/async-queue.ts"
export { combineSignals, mergeStreams, sleep } from "./util/streams.ts"

// ─── 4. User configuration (~/.omni/) ──────────────────────────────────────

export {
  omniHome,
  omniConfigPath,
  omniDbPath,
  omniTracesDir,
  omniMemoryPath,
  omniSettingsPath,
  omniPaths,
  workspaceOmniDir,
  workspacePaths,
  userCommandsDir,
  userSkillsDir,
  userHooksDir,
} from "./paths.ts"
export type { OmniPaths, WorkspacePaths } from "./paths.ts"

export {
  ConfigSchema,
  loadConfig,
  saveConfig,
  ensureOmniHome,
  resolveApiKey,
  resolveBaseURL,
  loadMergedConfig,
  mergeConfigs,
  expandEnv,
  expandEnvDeep,
} from "./config.ts"
export type { Config } from "./config.ts"
