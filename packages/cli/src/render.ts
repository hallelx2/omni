import type { EngineEvent } from "@omni/core"
import { ansi } from "./ansi.ts"

/**
 * Render a single engine event as terminal output. Returns a string (or empty
 * for events that produce no visible output). Side-effect free; the caller
 * writes it.
 *
 * For streaming events (delta, thinking_delta) returns a fragment that
 * should be appended to the current line. For lifecycle events returns a
 * fully-formed line including a trailing newline.
 */
export function renderEvent(ev: EngineEvent): string {
  switch (ev.type) {
    case "engine.start":
      return ""
    case "engine.iteration":
      return `\n${ansi.gray(`[iter ${ev.iteration}/${ev.maxIterations}]`)}\n`
    case "model.start":
      return ansi.bold("assistant: ")
    case "model.thinking_delta":
      return ansi.dim(ev.text)
    case "model.delta":
      return ev.text
    case "model.tool_call_done":
      return `\n  ${ansi.cyan("→ tool")} ${ev.call.name}(${ansi.dim(truncate(JSON.stringify(ev.call.args), 200))})\n`
    case "model.done":
      return "\n"
    case "tool.permission_requested":
      return ev.tool.permission === "auto"
        ? ""
        : `  ${ansi.yellow("?")} permission ${ev.tool.name}\n`
    case "tool.permission_granted":
      return ""
    case "tool.permission_denied":
      return `  ${ansi.red("!")} denied: ${ev.call.name}\n`
    case "tool.start":
      return `  ${ansi.gray("…")} ${ev.call.name}\n`
    case "tool.progress":
      return `     ${ansi.dim("·")} ${ansi.dim(ev.message)}\n`
    case "tool.result": {
      const preview = truncate(formatResult(ev.result), 240)
      return `  ${ansi.green("✓")} ${ansi.dim(`${ev.durationMs}ms`)} ${preview}\n`
    }
    case "tool.error":
      return `  ${ansi.red("✗")} ${ev.call.name}: ${ev.error.message} ${ansi.gray(`[${ev.error.category}]`)}\n`
    case "tool.invalid":
      return `  ${ansi.red("!")} invalid call: ${ev.reason}\n`
    case "engine.usage":
      return `  ${ansi.gray(`[tokens: +${ev.delta.totalTokens} / total ${ev.total.totalTokens}${ev.total.costUsd ? ` / $${ev.total.costUsd.toFixed(4)}` : ""}]`)}\n`
    case "engine.retrying":
      return `  ${ansi.yellow("↻")} retrying (${ev.reason}) in ${ev.delayMs}ms\n`
    case "engine.loop_detected":
      return `\n${ansi.yellow("⚠")} loop detected — same call set ${ev.occurrences}× in a row\n`
    case "engine.warning":
      return `  ${ansi.yellow("⚠")} [${ev.category}] ${ev.message}\n`
    case "engine.error":
      return `\n${ansi.red("✗ error")} ${ev.error.category}: ${ev.error.message}\n`
    case "engine.done":
      return `\n${ansi.bold("done")} ${ansi.gray(`(${ev.reason}, ${ev.durationMs}ms, ${ev.usage.totalTokens} tokens${ev.usage.costUsd ? `, $${ev.usage.costUsd.toFixed(4)}` : ""})`)}\n`
    case "context.compacted":
      return `  ${ansi.gray(`[compaction: ${ev.messagesBefore} → ${ev.messagesAfter}]`)}\n`
    case "verifier.start":
      return `     ${ansi.dim(`[verify:${ev.verifier}…]`)}\n`
    case "verifier.progress":
      return `       ${ansi.dim("·")} ${ansi.dim(ev.message)}\n`
    case "verifier.result": {
      const t = ansi.gray(`${ev.durationMs}ms`)
      if (ev.status === "pass") {
        return `     ${ansi.green("✓")} ${ansi.gray(`verify:${ev.verifier}`)} ${t}\n`
      }
      if (ev.status === "skip") {
        return `     ${ansi.gray(`◌ verify:${ev.verifier} skipped`)} ${ev.reason ? ansi.gray(`(${ev.reason})`) : ""}\n`
      }
      // fail — show the reason inline so the user knows what tripped
      return `     ${ansi.red("✗")} ${ansi.red(`verify:${ev.verifier}`)} ${ev.reason ?? ""} ${t}\n`
    }
    default:
      return ""
  }
}

function formatResult(v: unknown): string {
  if (typeof v === "string") return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}
