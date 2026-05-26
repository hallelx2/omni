import type { Message, ModelAdapter } from "@omni/core"
import type { RunMode } from "./mode.ts"

/**
 * Tiny pre-pass that picks a run mode from the user's input. Opt-in via
 * `config.modes.autoClassify`. Adds ~30 input tokens + 1–5 output tokens per
 * turn — cheap. Returns `null` when the model's reply isn't a clean classifier
 * answer or the call fails; the surface should keep the current mode in that
 * case rather than guess.
 */
const SYSTEM = `You classify a developer's request into ONE of three modes.

- "plan":  research, analysis, discussion, or planning — they want to think
           through an approach or get information BEFORE any code changes.
- "auto":  a small, clear, low-stakes change you can do without checking in
           (typo fix, format, rename within a single module, add a tiny test).
- "build": a meaningful code change that warrants oversight — the default
           when in doubt.

Reply with EXACTLY one word: plan, auto, or build. Nothing else.`

export async function classifyIntent(
  input: string,
  adapter: ModelAdapter,
  opts: { signal?: AbortSignal } = {},
): Promise<RunMode | null> {
  if (!input.trim()) return null
  const local = opts.signal ? null : new AbortController()
  const signal = opts.signal ?? local!.signal
  const messages: readonly Message[] = [
    { id: "ac-sys", role: "system", content: SYSTEM, timestamp: Date.now() },
    { id: "ac-user", role: "user", content: input, timestamp: Date.now() },
  ]
  let text = ""
  try {
    for await (const ev of adapter.complete({ messages, tools: [], signal })) {
      if (ev.type === "delta") text += ev.text
      else if (ev.type === "done") break
      else if (ev.type === "error") return null
    }
  } catch {
    return null
  }
  const t = text.trim().toLowerCase()
  if (t.startsWith("plan")) return "plan"
  if (t.startsWith("auto")) return "auto"
  if (t.startsWith("build")) return "build"
  return null
}
