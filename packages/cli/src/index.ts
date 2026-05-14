/**
 * `@omni/cli` — interactive terminal surface for the Omni harness.
 *
 * Entry point: `./bin.ts` (registered as the `omni` binary).
 *
 * Public exports here are re-usable building blocks: ANSI helpers,
 * permission prompts, event rendering, and slash commands.
 */
export { ansi, clearLastLines } from "./ansi.ts"
export { loadDotenv } from "./env.ts"
export { confirm, readLine } from "./prompts.ts"
export { renderEvent } from "./render.ts"
export { tryDispatchCommand, listCommands } from "./commands.ts"
export type { SlashCommand, CommandContext, CommandResult } from "./commands.ts"
