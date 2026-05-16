/**
 * `@omni/tools` — built-in tool implementations.
 *
 * Each tool follows the {@link Tool} contract from `@omni/core`. Tools are
 * registered with the engine via the `tools` field of `EngineConfig`.
 *
 * Permission posture per tool:
 *   - auto: side-effect-free reads (glob, grep, read_file)
 *   - ask:  side-effect-causing writes/exec (bash, edit, write_file, web_fetch)
 */
export { bash } from "./bash.ts"
export type { BashArgs, BashResult } from "./bash.ts"

export { readFile, writeFile } from "./fs.ts"

export { edit } from "./edit.ts"
export type { EditResult } from "./edit.ts"

export { multiEdit } from "./multi_edit.ts"
export type { MultiEditResult } from "./multi_edit.ts"

export { applyPatch, parseUnifiedDiff } from "./apply_patch.ts"
export type { ApplyPatchResult, ApplyPatchHunkResult } from "./apply_patch.ts"

export { glob } from "./glob.ts"
export type { GlobResult } from "./glob.ts"

export { grep } from "./grep.ts"
export type { GrepMatch, GrepResult } from "./grep.ts"

export { webFetch } from "./web_fetch.ts"
export type { WebFetchResult } from "./web_fetch.ts"

export { MCPClient } from "./mcp.ts"
export type { MCPClientConfig, StdioMCPConfig, HTTPMCPConfig } from "./mcp.ts"

export { MCPManager } from "./mcp-manager.ts"
export type { MCPServerState, MCPServerStatus } from "./mcp-manager.ts"

// ── Verifiers (CRITIC pattern) ────────────────────────────────────────────
export {
  PatchAppliesVerifier,
  FileParsesVerifier,
  TypecheckVerifier,
  TestVerifier,
  runShellVerifier,
} from "./verifiers/index.ts"
export type {
  TypecheckVerifierOptions,
  TestVerifierOptions,
} from "./verifiers/index.ts"
