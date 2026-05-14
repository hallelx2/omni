import { jsonSchema, tool, type Tool as AISDKTool } from "ai"
import type { ToolSchema } from "@omni/core"

/**
 * Translate Omni `ToolSchema` (JSON Schema-based) into AI SDK 6 tool definitions.
 * We deliberately do NOT supply an `execute` function — the engine owns
 * execution; we just need the provider to forward tool calls back to us.
 */
export function toolsToAISDK(tools: readonly ToolSchema[]): Record<string, AISDKTool> {
  const out: Record<string, AISDKTool> = {}
  for (const t of tools) {
    out[t.name] = tool({
      description: t.description,
      inputSchema: jsonSchema(t.parameters as Parameters<typeof jsonSchema>[0]),
    }) as AISDKTool
  }
  return out
}
