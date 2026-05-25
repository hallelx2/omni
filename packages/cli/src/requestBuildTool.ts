/**
 * `request_build_mode` — an engine tool the agent calls (from plan mode) to ask
 * to switch into build mode and begin making changes. The surface supplies an
 * optional `confirm` handler (a TUI modal or a readline prompt) which acts as
 * the human gate; if omitted, the switch is auto-approved.
 *
 * It mutates the shared {@link ModeHolder} captured at construction — the same
 * closure-tool pattern as `ask_user`. The switch takes effect on the NEXT turn
 * (the engine reads `enabledTools` once per run), which is the safe semantic.
 */
import { z } from "zod"
import type { Tool, ToolContext } from "@omni/core"
import type { ModeHolder, RunMode } from "./mode.ts"

const RequestBuildArgs = z.object({
  reason: z.string().optional().describe("Why you are ready to switch to build mode."),
  plan: z.string().optional().describe("Optional summary of the plan you intend to execute."),
})

export interface RequestBuildResult {
  readonly switched: boolean
  readonly mode: RunMode
}

export function createRequestBuildTool(
  mode: ModeHolder,
  opts?: { confirm?: (plan: string | null) => Promise<boolean> },
): Tool<{ reason?: string; plan?: string }, RequestBuildResult> {
  return {
    name: "request_build_mode",
    description:
      "Request switching from plan mode to build mode so you can edit files and run commands. " +
      "Call this once your plan is ready. No-op if already in build mode.",
    permission: "auto", // the confirm() handler is the human gate, not the permission system
    schema: RequestBuildArgs,
    async execute(args, _ctx: ToolContext): Promise<RequestBuildResult> {
      if (mode.get() === "build") return { switched: false, mode: "build" }
      const ok = opts?.confirm ? await opts.confirm(args.plan ?? args.reason ?? null) : true
      if (ok) mode.set("build", "agent")
      return { switched: ok, mode: mode.get() }
    },
  }
}
