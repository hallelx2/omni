/**
 * Type-only entry. Use when you need to import types without pulling in any
 * runtime code:
 *
 * ```ts
 * import type { Engine, Tool, EngineEvent } from "@omni/core/types"
 * ```
 */
export type * from "./types.ts"
export type * from "./events.ts"
export type { EngineConfig, RunOptions } from "./engine.ts"
export type { PermissionGate, PermissionDecision, AskHandler } from "./permissions.ts"
export type { ContextStrategy, ContextLimits } from "./context.ts"
export type { ValidationResult } from "./validator.ts"
export type { ClassifiedError, ErrorCategory, ClassifyHints } from "./util/errors.ts"
