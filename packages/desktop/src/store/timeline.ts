/**
 * Folds the engine's event stream (and persisted history) into a flat, ordered
 * timeline the chat view renders. Pure + immutable: each fold returns new state.
 */
import type { ChatMessage, EngineEvent, ToolCall, UsageSummary } from "@/lib/protocol"

export interface VerifierNote {
  name: string
  status: "pass" | "fail" | "skip"
  reason?: string
}

export type TimelineItem =
  | { id: string; kind: "user"; text: string; ts: number }
  | { id: string; kind: "assistant"; text: string; ts: number; streaming?: boolean }
  | { id: string; kind: "thinking"; text: string; ts: number; streaming?: boolean }
  | {
      id: string
      kind: "tool"
      callId: string
      name: string
      args: unknown
      status: "running" | "ok" | "error"
      result?: unknown
      error?: string
      progress?: string
      durationMs?: number
      verifiers?: VerifierNote[]
      ts: number
    }
  | { id: string; kind: "notice"; level: "info" | "warn" | "error" | "success"; text: string; ts: number }

/** Live agent activity, used to render a "what's happening now" indicator. */
export type Phase = "idle" | "thinking" | "streaming" | "tool"

export interface SessionState {
  timeline: TimelineItem[]
  running: boolean
  /** What the agent is doing right now (drives the live activity row). */
  phase: Phase
  /** Name of the tool currently executing, when phase === "tool". */
  activeTool: string | null
  /** Current engine iteration, surfaced subtly while running. */
  iteration: number
  usage: UsageSummary
  currentAssistantId: string | null
  currentThinkingId: string | null
  /** monotonically increasing id source for generated items */
  seq: number
  loaded: boolean
}

export const ZERO_USAGE: UsageSummary = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  callCount: 0,
}

export function emptySession(): SessionState {
  return {
    timeline: [],
    running: false,
    phase: "idle",
    activeTool: null,
    iteration: 0,
    usage: ZERO_USAGE,
    currentAssistantId: null,
    currentThinkingId: null,
    seq: 0,
    loaded: false,
  }
}

function gen(s: SessionState, prefix: string): string {
  s.seq += 1
  return `${prefix}-${s.seq}`
}

/** Append a user message (called optimistically when the user submits). */
export function pushUser(prev: SessionState, text: string): SessionState {
  const s = clone(prev)
  s.timeline = [...s.timeline, { id: gen(s, "u"), kind: "user", text, ts: Date.now() }]
  s.running = true
  s.phase = "thinking"
  s.activeTool = null
  s.currentAssistantId = null
  s.currentThinkingId = null
  return s
}

/** Fold a single engine event into session state. */
export function foldEvent(prev: SessionState, ev: EngineEvent): SessionState {
  const s = clone(prev)
  switch (ev.type) {
    case "engine.start":
      s.running = true
      s.phase = "thinking"
      break

    case "engine.iteration":
      s.iteration = (ev as { iteration: number }).iteration ?? s.iteration
      if (s.phase === "idle") s.phase = "thinking"
      break

    case "model.start": {
      const id = gen(s, "a")
      s.currentAssistantId = id
      s.currentThinkingId = null
      s.phase = "streaming"
      s.timeline = [...s.timeline, { id, kind: "assistant", text: "", ts: Date.now(), streaming: true }]
      break
    }

    case "model.delta": {
      const text = (ev as { text: string }).text ?? ""
      s.phase = "streaming"
      s.timeline = appendToCurrent(s, "assistant", "currentAssistantId", text)
      break
    }

    case "model.thinking_delta": {
      const text = (ev as { text: string }).text ?? ""
      s.phase = "streaming"
      s.timeline = appendToCurrent(s, "thinking", "currentThinkingId", text)
      break
    }

    case "model.done":
      finalizeStreaming(s)
      s.phase = "thinking"
      break

    case "model.tool_call_done": {
      const call = (ev as { call: ToolCall }).call
      upsertTool(s, call, { status: "running" })
      break
    }

    case "tool.start": {
      const call = (ev as { call: ToolCall }).call
      finalizeStreaming(s)
      s.phase = "tool"
      s.activeTool = call.name
      upsertTool(s, call, { status: "running" })
      break
    }

    case "tool.progress": {
      const e = ev as { call: ToolCall; message: string }
      upsertTool(s, e.call, { progress: e.message })
      break
    }

    case "tool.result": {
      const e = ev as { call: ToolCall; result: unknown; durationMs: number }
      upsertTool(s, e.call, { status: "ok", result: e.result, durationMs: e.durationMs })
      s.phase = "thinking"
      s.activeTool = null
      break
    }

    case "tool.error": {
      const e = ev as { call: ToolCall; error: { message: string }; durationMs: number }
      upsertTool(s, e.call, { status: "error", error: e.error?.message, durationMs: e.durationMs })
      s.phase = "thinking"
      s.activeTool = null
      break
    }

    case "verifier.result": {
      const e = ev as { call: ToolCall; verifier: string; status: "pass" | "fail" | "skip"; reason?: string }
      addVerifier(s, e.call.id, { name: e.verifier, status: e.status, reason: e.reason })
      break
    }

    case "engine.usage": {
      const total = (ev as { total: UsageSummary }).total
      if (total) s.usage = total
      break
    }

    case "engine.retrying": {
      const e = ev as { attempt: number; reason: string }
      pushNotice(s, "warn", `Retrying (attempt ${e.attempt}) — ${e.reason}`)
      break
    }

    case "engine.loop_detected":
      pushNotice(s, "warn", "Loop detected — stopping to avoid repetition.")
      break

    case "context.compacted": {
      const e = ev as { messagesBefore: number; messagesAfter: number }
      pushNotice(s, "info", `Context compacted (${e.messagesBefore} → ${e.messagesAfter} messages).`)
      break
    }

    case "engine.warning": {
      const e = ev as { message: string }
      pushNotice(s, "warn", e.message)
      break
    }

    case "engine.error": {
      const e = ev as { error: { message: string } }
      finalizeStreaming(s)
      pushNotice(s, "error", e.error?.message ?? "Engine error")
      s.running = false
      s.phase = "idle"
      s.activeTool = null
      break
    }

    case "engine.done": {
      finalizeStreaming(s)
      s.running = false
      s.phase = "idle"
      s.activeTool = null
      const e = ev as { usage?: UsageSummary; reason?: string }
      if (e.usage) s.usage = e.usage
      if (e.reason === "max_iterations") pushNotice(s, "warn", "Reached the iteration limit.")
      if (e.reason === "aborted") pushNotice(s, "info", "Stopped.")
      break
    }
  }
  return s
}

function appendToCurrent(
  s: SessionState,
  kind: "assistant" | "thinking",
  ptr: "currentAssistantId" | "currentThinkingId",
  text: string,
): TimelineItem[] {
  let id = s[ptr]
  const timeline = s.timeline.slice()
  if (!id) {
    id = gen(s, kind === "assistant" ? "a" : "t")
    s[ptr] = id
    timeline.push({ id, kind, text, ts: Date.now(), streaming: true } as TimelineItem)
    return timeline
  }
  const idx = timeline.findIndex((t) => t.id === id)
  if (idx >= 0) {
    const item = timeline[idx] as Extract<TimelineItem, { kind: "assistant" | "thinking" }>
    timeline[idx] = { ...item, text: item.text + text }
  }
  return timeline
}

function upsertTool(
  s: SessionState,
  call: ToolCall,
  patch: Partial<Extract<TimelineItem, { kind: "tool" }>>,
): void {
  finalizeStreaming(s)
  const timeline = s.timeline.slice()
  const idx = timeline.findIndex((t) => t.kind === "tool" && t.callId === call.id)
  if (idx >= 0) {
    timeline[idx] = { ...(timeline[idx] as Extract<TimelineItem, { kind: "tool" }>), ...patch }
  } else {
    timeline.push({
      id: gen(s, "tool"),
      kind: "tool",
      callId: call.id,
      name: call.name,
      args: call.args,
      status: "running",
      ts: Date.now(),
      ...patch,
    })
  }
  s.timeline = timeline
}

function addVerifier(s: SessionState, callId: string, note: VerifierNote): void {
  const timeline = s.timeline.slice()
  const idx = timeline.findIndex((t) => t.kind === "tool" && t.callId === callId)
  if (idx >= 0) {
    const item = timeline[idx] as Extract<TimelineItem, { kind: "tool" }>
    timeline[idx] = { ...item, verifiers: [...(item.verifiers ?? []), note] }
    s.timeline = timeline
  }
}

function pushNotice(s: SessionState, level: "info" | "warn" | "error" | "success", text: string): void {
  s.timeline = [...s.timeline, { id: gen(s, "n"), kind: "notice", level, text, ts: Date.now() }]
}

function finalizeStreaming(s: SessionState): void {
  if (!s.currentAssistantId && !s.currentThinkingId) return
  s.timeline = s.timeline.map((t) =>
    (t.kind === "assistant" || t.kind === "thinking") && (t.id === s.currentAssistantId || t.id === s.currentThinkingId)
      ? { ...t, streaming: false }
      : t,
  )
  s.currentAssistantId = null
  s.currentThinkingId = null
}

function clone(s: SessionState): SessionState {
  return { ...s }
}

/** Convert persisted history into a timeline (used when resuming a session). */
export function messagesToTimeline(messages: ChatMessage[]): TimelineItem[] {
  const out: TimelineItem[] = []
  const toolByCall = new Map<string, Extract<TimelineItem, { kind: "tool" }>>()
  let n = 0
  const id = (p: string) => `${p}-${++n}`
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ id: id("u"), kind: "user", text: m.content, ts: m.timestamp })
    } else if (m.role === "assistant") {
      if (m.content.trim()) {
        out.push({ id: id("a"), kind: "assistant", text: m.content, ts: m.timestamp })
      }
      for (const call of m.toolCalls ?? []) {
        const item: Extract<TimelineItem, { kind: "tool" }> = {
          id: id("tool"),
          kind: "tool",
          callId: call.id,
          name: call.name,
          args: call.args,
          status: "ok",
          ts: m.timestamp,
        }
        toolByCall.set(call.id, item)
        out.push(item)
      }
    } else if (m.role === "tool") {
      const item = m.toolCallId ? toolByCall.get(m.toolCallId) : undefined
      if (item) item.result = m.content
    }
  }
  return out
}
