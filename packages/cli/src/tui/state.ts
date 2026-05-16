import { createSignal, createMemo } from "solid-js"
import type { CumulativeUsage, EngineEvent, ToolCall } from "@omni/core"

/**
 * Reactive store for the TUI. Engine events flow into here through
 * `pushEvent`; components read derived signals for renderable state.
 *
 * The point of putting all the engine state in Solid signals is that
 * a tiny streaming model.delta arriving every 30ms doesn't need to
 * re-render anything except the partial assistant text — Solid's
 * fine-grained reactivity wins here.
 */

// ─── Message log entries (display shape) ───────────────────────────────────

export type MessageEntry =
  | { kind: "user"; id: string; text: string; ts: number }
  | { kind: "assistant"; id: string; text: string; ts: number; streaming: boolean; thinking?: string }
  | { kind: "tool"; id: string; call: ToolCall; ts: number; status: ToolStatus; durationMs?: number; resultPreview?: string; errorMessage?: string; verifiers: VerifierEntry[] }
  | { kind: "system"; id: string; text: string; ts: number; tone?: "info" | "warn" | "error" | "dim" }

export type ToolStatus = "pending" | "running" | "ok" | "error" | "denied" | "invalid"

export interface VerifierEntry {
  readonly name: string
  status: "running" | "pass" | "fail" | "skip"
  reason?: string
  feedback?: string
  durationMs?: number
}

// ─── Status pills ──────────────────────────────────────────────────────────

export interface StatusState {
  readonly modelName: string
  readonly profile: {
    readonly nativeTools: boolean
    readonly follows: boolean
    readonly verbose: boolean
  } | null
  readonly iter: number
  readonly maxIter: number
  readonly skillName: string | null
  readonly memoryHits: number
  readonly mcpServers: number
  readonly verifierPass: number
  readonly verifierFail: number
  readonly usage: CumulativeUsage
}

// ─── Store ────────────────────────────────────────────────────────────────

export function createTuiStore(initial: {
  modelName: string
  mcpServers: number
}) {
  // Message log — appending arrays in Solid via signal-replace; the entries
  // themselves carry mutable status, but we replace the array on insert.
  const [messages, setMessages] = createSignal<readonly MessageEntry[]>([], { equals: false })

  const [modelName, setModelName] = createSignal(initial.modelName)
  const [profile, setProfile] = createSignal<StatusState["profile"]>(null)
  const [iter, setIter] = createSignal(0)
  const [maxIter, setMaxIter] = createSignal(0)
  const [skillName, setSkillName] = createSignal<string | null>(null)
  const [memoryHits, setMemoryHits] = createSignal(0)
  const [mcpServers, setMcpServers] = createSignal(initial.mcpServers)
  const [verifierPass, setVerifierPass] = createSignal(0)
  const [verifierFail, setVerifierFail] = createSignal(0)
  const [usage, setUsage] = createSignal<CumulativeUsage>({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    callCount: 0,
  })
  const [running, setRunning] = createSignal(false)

  // Active streaming assistant message id — used to append model.delta text.
  let activeAssistantId: string | null = null
  let toolIndex = new Map<string, number>() // call.id → index in messages

  function appendMessage(entry: MessageEntry): void {
    setMessages((prev) => [...prev, entry])
  }
  function updateMessage(index: number, updater: (m: MessageEntry) => MessageEntry): void {
    setMessages((prev) => {
      const out = [...prev]
      out[index] = updater(out[index]!)
      return out
    })
  }

  function pushUser(text: string): void {
    appendMessage({
      kind: "user",
      id: cryptoId(),
      text,
      ts: Date.now(),
    })
  }

  /**
   * Translate an EngineEvent into store mutations. Returns nothing — the
   * UI re-renders from signals.
   */
  function pushEvent(ev: EngineEvent): void {
    switch (ev.type) {
      case "engine.start":
        setRunning(true)
        activeAssistantId = null
        toolIndex = new Map()
        return
      case "engine.iteration":
        setIter(ev.iteration)
        setMaxIter(ev.maxIterations)
        return
      case "engine.done":
        setRunning(false)
        // Close out any still-streaming assistant message.
        if (activeAssistantId) {
          const idx = findMessageIndex((m) => m.kind === "assistant" && m.id === activeAssistantId)
          if (idx >= 0) {
            updateMessage(idx, (m) => (m.kind === "assistant" ? { ...m, streaming: false } : m))
          }
          activeAssistantId = null
        }
        setUsage(ev.usage)
        return
      case "engine.error":
        appendMessage({
          kind: "system",
          id: cryptoId(),
          text: `error: ${ev.error.category} — ${ev.error.message}`,
          ts: Date.now(),
          tone: "error",
        })
        setRunning(false)
        return
      case "engine.usage":
        setUsage(ev.total)
        return
      case "engine.warning":
        appendMessage({
          kind: "system",
          id: cryptoId(),
          text: `[${ev.category}] ${ev.message}`,
          ts: Date.now(),
          tone: "warn",
        })
        return
      case "engine.retrying":
        appendMessage({
          kind: "system",
          id: cryptoId(),
          text: `retrying (${ev.reason}) in ${ev.delayMs}ms`,
          ts: Date.now(),
          tone: "dim",
        })
        return
      case "engine.loop_detected":
        appendMessage({
          kind: "system",
          id: cryptoId(),
          text: `loop detected — same call set ${ev.occurrences}× in a row`,
          ts: Date.now(),
          tone: "warn",
        })
        return

      case "model.start":
        activeAssistantId = cryptoId()
        appendMessage({
          kind: "assistant",
          id: activeAssistantId,
          text: "",
          ts: Date.now(),
          streaming: true,
        })
        return
      case "model.delta": {
        if (!activeAssistantId) return
        const idx = findMessageIndex((m) => m.kind === "assistant" && m.id === activeAssistantId)
        if (idx < 0) return
        updateMessage(idx, (m) =>
          m.kind === "assistant" ? { ...m, text: m.text + ev.text } : m,
        )
        return
      }
      case "model.thinking_delta": {
        if (!activeAssistantId) return
        const idx = findMessageIndex((m) => m.kind === "assistant" && m.id === activeAssistantId)
        if (idx < 0) return
        updateMessage(idx, (m) =>
          m.kind === "assistant" ? { ...m, thinking: (m.thinking ?? "") + ev.text } : m,
        )
        return
      }
      case "model.done": {
        if (!activeAssistantId) return
        const idx = findMessageIndex((m) => m.kind === "assistant" && m.id === activeAssistantId)
        if (idx >= 0) {
          updateMessage(idx, (m) =>
            m.kind === "assistant" ? { ...m, streaming: false } : m,
          )
        }
        activeAssistantId = null
        return
      }

      case "tool.start": {
        const id = ev.call.id
        const entry: MessageEntry = {
          kind: "tool",
          id,
          call: ev.call,
          ts: Date.now(),
          status: "running",
          verifiers: [],
        }
        appendMessage(entry)
        toolIndex.set(id, currentLength() - 1)
        return
      }
      case "tool.progress": {
        // Cheap implementation: don't render progress lines for now (they
        // spam the log on long-running tools). Could surface in a sidebar.
        return
      }
      case "tool.result": {
        const idx = toolIndex.get(ev.call.id)
        if (idx === undefined) return
        updateMessage(idx, (m) =>
          m.kind === "tool"
            ? { ...m, status: "ok", durationMs: ev.durationMs, resultPreview: shortPreview(ev.result) }
            : m,
        )
        return
      }
      case "tool.error": {
        const idx = toolIndex.get(ev.call.id)
        if (idx === undefined) return
        updateMessage(idx, (m) =>
          m.kind === "tool"
            ? { ...m, status: "error", durationMs: ev.durationMs, errorMessage: ev.error.message }
            : m,
        )
        return
      }
      case "tool.invalid": {
        const idx = toolIndex.get(ev.call.id)
        if (idx === undefined) {
          // tool.invalid fires before tool.start sometimes
          appendMessage({
            kind: "tool",
            id: ev.call.id,
            call: ev.call,
            ts: Date.now(),
            status: "invalid",
            verifiers: [],
            errorMessage: ev.reason,
          })
          return
        }
        updateMessage(idx, (m) =>
          m.kind === "tool" ? { ...m, status: "invalid", errorMessage: ev.reason } : m,
        )
        return
      }
      case "tool.permission_denied": {
        const idx = toolIndex.get(ev.call.id)
        if (idx === undefined) {
          appendMessage({
            kind: "tool",
            id: ev.call.id,
            call: ev.call,
            ts: Date.now(),
            status: "denied",
            verifiers: [],
          })
          return
        }
        updateMessage(idx, (m) =>
          m.kind === "tool" ? { ...m, status: "denied" } : m,
        )
        return
      }

      case "verifier.start": {
        const idx = toolIndex.get(ev.call.id)
        if (idx === undefined) return
        updateMessage(idx, (m) => {
          if (m.kind !== "tool") return m
          return {
            ...m,
            verifiers: [...m.verifiers, { name: ev.verifier, status: "running" }],
          }
        })
        return
      }
      case "verifier.result": {
        const idx = toolIndex.get(ev.call.id)
        if (idx === undefined) return
        if (ev.status === "pass") setVerifierPass((n) => n + 1)
        else if (ev.status === "fail") setVerifierFail((n) => n + 1)
        updateMessage(idx, (m) => {
          if (m.kind !== "tool") return m
          const vs = m.verifiers.map((v) =>
            v.name === ev.verifier
              ? {
                  ...v,
                  status: ev.status,
                  reason: ev.reason,
                  feedback: ev.feedback,
                  durationMs: ev.durationMs,
                }
              : v,
          )
          // If the verifier wasn't pre-registered (race), add it.
          if (!vs.find((v) => v.name === ev.verifier)) {
            vs.push({
              name: ev.verifier,
              status: ev.status,
              reason: ev.reason,
              feedback: ev.feedback,
              durationMs: ev.durationMs,
            })
          }
          return { ...m, verifiers: vs }
        })
        return
      }
    }
  }

  function findMessageIndex(pred: (m: MessageEntry) => boolean): number {
    const arr = messages()
    for (let i = arr.length - 1; i >= 0; i--) {
      if (pred(arr[i]!)) return i
    }
    return -1
  }
  function currentLength(): number {
    return messages().length
  }

  // Status snapshot (memoized so the status bar re-renders cheaply).
  const status = createMemo<StatusState>(() => ({
    modelName: modelName(),
    profile: profile(),
    iter: iter(),
    maxIter: maxIter(),
    skillName: skillName(),
    memoryHits: memoryHits(),
    mcpServers: mcpServers(),
    verifierPass: verifierPass(),
    verifierFail: verifierFail(),
    usage: usage(),
  }))

  function pushSystem(text: string, tone: "info" | "warn" | "error" | "dim" = "info"): void {
    appendMessage({
      kind: "system",
      id: cryptoId(),
      text,
      ts: Date.now(),
      tone,
    })
  }

  return {
    messages,
    status,
    running,
    pushUser,
    pushEvent,
    pushSystem,
    setProfile,
    setSkillName,
    setModelName,
    setMcpServers,
  }
}

export type TuiStore = ReturnType<typeof createTuiStore>

// ─── Helpers ──────────────────────────────────────────────────────────────

function cryptoId(): string {
  // Cheap, monotonic-ish id; not security-sensitive.
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function shortPreview(value: unknown): string {
  if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 120)}…` : value
  try {
    const s = JSON.stringify(value)
    return s.length > 120 ? `${s.slice(0, 120)}…` : s
  } catch {
    return String(value)
  }
}
