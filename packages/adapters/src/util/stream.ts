import type { TextStreamPart, ToolSet, FinishReason as AISDKFinishReason } from "ai"
import type { FinishReason, ModelEvent, ToolCall } from "@omni/core"

/**
 * Translate AI SDK 6's `fullStream` of `TextStreamPart`s into Omni's
 * normalized `ModelEvent` stream.
 *
 * Handled events:
 *   - text-delta            → delta
 *   - reasoning-delta       → thinking_delta
 *   - tool-input-start      → tool_call_start (synthesized ToolCall, args TBD)
 *   - tool-input-delta      → tool_call_args_delta
 *   - tool-call             → tool_call (final, with parsed args)
 *   - finish                → done (with usage)
 *   - error / abort         → error
 *
 * Ignored (no Omni equivalent today):
 *   - text-start, text-end, reasoning-start, reasoning-end
 *   - tool-input-end (we get tool-call right after)
 *   - tool-result, tool-error (we never let AI SDK execute tools)
 *   - source, file, start, start-step, finish-step, tool-approval-request,
 *     tool-output-denied
 */
export async function* translateStream(
  source: AsyncIterable<TextStreamPart<ToolSet>>,
): AsyncIterable<ModelEvent> {
  // Track in-progress tool calls so tool_call_start can carry the name even
  // before args are known.
  const pending = new Map<string, { name: string }>()

  for await (const part of source) {
    switch (part.type) {
      case "text-delta":
        if (part.text) yield { type: "delta", text: part.text }
        break

      case "reasoning-delta":
        if (part.text) yield { type: "thinking_delta", text: part.text }
        break

      case "tool-input-start": {
        pending.set(part.id, { name: part.toolName })
        const call: ToolCall = { id: part.id, name: part.toolName, args: undefined }
        yield { type: "tool_call_start", call }
        break
      }

      case "tool-input-delta":
        yield {
          type: "tool_call_args_delta",
          callId: part.id,
          argsDelta: part.delta,
        }
        break

      case "tool-call": {
        const call: ToolCall = {
          id: part.toolCallId,
          name: part.toolName,
          args: part.input,
        }
        pending.delete(part.toolCallId)
        yield { type: "tool_call", call }
        break
      }

      case "finish":
        yield {
          type: "done",
          finishReason: mapFinishReason(part.finishReason),
          usage: {
            promptTokens: part.totalUsage.inputTokens ?? 0,
            completionTokens: part.totalUsage.outputTokens ?? 0,
            totalTokens: part.totalUsage.totalTokens ?? 0,
            cachedInputTokens: part.totalUsage.cachedInputTokens ?? 0,
          },
        }
        break

      case "abort":
        yield {
          type: "error",
          error: Object.assign(new Error(part.reason ?? "aborted"), { name: "AbortError" }),
        }
        break

      case "error": {
        const err =
          part.error instanceof Error
            ? part.error
            : new Error(typeof part.error === "string" ? part.error : JSON.stringify(part.error))
        yield { type: "error", error: err }
        break
      }

      // The remaining events are intentionally ignored.
      default:
        break
    }
  }
}

function mapFinishReason(r: AISDKFinishReason | undefined): FinishReason {
  switch (r) {
    case "stop":
      return "stop"
    case "length":
      return "length"
    case "tool-calls":
      return "tool_calls"
    case "content-filter":
      return "content_filter"
    case "error":
      return "error"
    case "other":
    default:
      return "unknown"
  }
}
