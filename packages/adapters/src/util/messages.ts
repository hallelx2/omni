import type { ModelMessage } from "ai"
import type { Message } from "@omni/core"

/**
 * Translate Omni's append-only message history into the AI SDK 6 `ModelMessage`
 * shape. Handles:
 *   - system / user / assistant / tool roles
 *   - assistant messages with multiple tool calls (becomes a content-parts array)
 *   - tool messages keyed by `toolCallId` (each becomes a tool-result part)
 *
 * Tool messages don't carry the tool name in Omni, so we walk backwards
 * through history to find the prior assistant message that emitted the call.
 */
export function messagesToAISDK(messages: readonly Message[]): ModelMessage[] {
  // Build a map: toolCallId → toolName from all prior assistant messages.
  const nameById = new Map<string, string>()
  for (const m of messages) {
    if (m.role === "assistant" && m.toolCalls) {
      for (const c of m.toolCalls) nameById.set(c.id, c.name)
    }
  }

  const out: ModelMessage[] = []
  for (const m of messages) {
    switch (m.role) {
      case "system":
        out.push({ role: "system", content: m.content })
        break

      case "user":
        out.push({ role: "user", content: m.content })
        break

      case "assistant": {
        const reasoning =
          typeof m.metadata?.reasoningContent === "string" ? m.metadata.reasoningContent : undefined
        const providerOptions = reasoning
          ? {
              // OpenAI-compatible providers (MiMo, DeepSeek, alibaba-cn, etc.)
              // require `reasoning_content` to be echoed back when thinking
              // mode emitted it on the previous turn.
              openaiCompatible: { reasoning_content: reasoning },
              // Anthropic-native — surface as a thinking block.
              anthropic: { thinking: { type: "thinking", thinking: reasoning } },
            }
          : undefined

        if (!m.toolCalls || m.toolCalls.length === 0) {
          out.push({
            role: "assistant",
            content: m.content,
            ...(providerOptions ? { providerOptions } : {}),
          })
          break
        }
        const parts: Array<
          | { type: "text"; text: string }
          | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
        > = []
        if (m.content) parts.push({ type: "text", text: m.content })
        for (const c of m.toolCalls) {
          parts.push({
            type: "tool-call",
            toolCallId: c.id,
            toolName: c.name,
            input: c.args,
          })
        }
        out.push({
          role: "assistant",
          content: parts,
          ...(providerOptions ? { providerOptions } : {}),
        })
        break
      }

      case "tool": {
        if (!m.toolCallId) {
          // Defensive: a tool message without an id is malformed; convert to user note.
          out.push({ role: "user", content: `[tool result without id] ${m.content}` })
          break
        }
        const toolName = nameById.get(m.toolCallId) ?? "unknown"
        out.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: m.toolCallId,
              toolName,
              output: { type: "text", value: m.content },
            },
          ],
        })
        break
      }
    }
  }

  return out
}
