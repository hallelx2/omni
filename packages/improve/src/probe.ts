import { z } from "zod"
import type { ModelAdapter, ToolSchema } from "@omni/core"
import { toToolSchema } from "@omni/core"

/**
 * Optional cache adapter so probe results survive process restarts.
 * Wire to a storage repo (e.g. `@omni/storage`'s ProfilesRepo) or to an
 * in-memory map for tests.
 */
export interface ProfileCache {
  get(modelId: string): ModelProfile | null | Promise<ModelProfile | null>
  set(profile: ModelProfile): void | Promise<void>
}

export interface ProbeCacheOptions {
  /** Don't re-probe if a cached result is younger than this (ms). Default 24h. */
  readonly maxAgeMs?: number
}

/**
 * Probe-with-cache. Returns a cached profile when one exists and is younger
 * than `maxAgeMs`; otherwise runs the probe and writes to the cache.
 */
export async function probeModelCached(
  model: ModelAdapter,
  cache: ProfileCache,
  cacheOpts: ProbeCacheOptions = {},
  probeOpts: ProbeOptions = {},
): Promise<ModelProfile> {
  const maxAge = cacheOpts.maxAgeMs ?? 24 * 60 * 60 * 1000
  const existing = await cache.get(model.id)
  if (existing && Date.now() - existing.probedAt < maxAge) {
    return existing
  }
  const fresh = await probeModel(model, probeOpts)
  await cache.set(fresh)
  return fresh
}

/** Trivial in-memory cache (tests/dev). */
export class InMemoryProfileCache implements ProfileCache {
  private readonly _store = new Map<string, ModelProfile>()
  get(modelId: string): ModelProfile | null {
    return this._store.get(modelId) ?? null
  }
  set(profile: ModelProfile): void {
    this._store.set(profile.modelId, profile)
  }
  clear(): void {
    this._store.clear()
  }
}

/**
 * Empirical capability profile for a model. Probed once on first contact
 * and persisted; subsequent runs read it to pick strategies (see {@link adapt}).
 */
export interface ModelProfile {
  readonly modelId: string
  readonly probedAt: number
  readonly nativeToolCalls: boolean
  readonly followsInstructions: boolean
  readonly verboseByDefault: boolean
  readonly averageLatencyMs: number
  readonly errorRate: number
  /** Tokens of context the model successfully echoed back (lower bound). */
  readonly verifiedContextTokens?: number
  /** Notes from individual probe steps. */
  readonly notes: readonly string[]
}

export interface ProbeOptions {
  /** Skip the tool-call probe (saves a model call). */
  readonly skipTools?: boolean
}

/**
 * Probe a model's capabilities with a small battery of cheap prompts.
 * Returns a {@link ModelProfile} that can be cached and consumed by
 * {@link adapt} to pick an execution strategy.
 *
 * Costs ~200–800 tokens per probe; safe to run on first contact.
 */
export async function probeModel(
  model: ModelAdapter,
  opts: ProbeOptions = {},
): Promise<ModelProfile> {
  const notes: string[] = []
  const latencies: number[] = []
  let errors = 0
  let probes = 0
  let followsInstructions = false
  let verboseByDefault = false
  let nativeToolCalls = false

  // Probe 1: instruction-following — exact word reply.
  probes++
  try {
    const t0 = Date.now()
    const reply = await collectText(model, [
      { role: "system", content: "Follow instructions exactly. No preamble, no explanation." },
      { role: "user", content: 'Reply with exactly the word "pong" and nothing else.' },
    ])
    latencies.push(Date.now() - t0)
    const trimmed = reply.trim().toLowerCase()
    if (trimmed === "pong" || trimmed === '"pong"') {
      followsInstructions = true
      notes.push("Probe 1 (instruction follow): pass")
    } else if (trimmed.includes("pong")) {
      notes.push(`Probe 1 (instruction follow): partial — replied with extra content (${reply.length} chars)`)
      if (reply.length > 30) verboseByDefault = true
    } else {
      notes.push(`Probe 1 (instruction follow): fail — got "${reply.slice(0, 80)}"`)
    }
  } catch (e) {
    errors++
    notes.push(`Probe 1 (instruction follow): error — ${(e as Error).message}`)
  }

  // Probe 2: tool calling.
  if (!opts.skipTools && model.capabilities.supportsToolCalls) {
    probes++
    const echoTool: ToolSchema = toToolSchema({
      name: "echo",
      description: "Echo back the input text",
      permission: "auto",
      schema: z.object({ text: z.string() }),
      execute: async () => ({}),
    })
    try {
      const t0 = Date.now()
      const { toolCalls } = await collectToolCalls(model, [echoTool], [
        { role: "system", content: "Use tools when available." },
        { role: "user", content: 'Use the echo tool with text="probe-ok".' },
      ])
      latencies.push(Date.now() - t0)
      const goodCall = toolCalls.find(
        (c) => c.name === "echo" && typeof c.args === "object" && c.args !== null && (c.args as { text?: string }).text === "probe-ok",
      )
      if (goodCall) {
        nativeToolCalls = true
        notes.push("Probe 2 (tool calling): pass — emitted correct tool_call")
      } else if (toolCalls.length > 0) {
        notes.push(`Probe 2 (tool calling): partial — emitted ${toolCalls.length} call(s) with wrong args`)
      } else {
        notes.push("Probe 2 (tool calling): fail — no native tool call emitted")
      }
    } catch (e) {
      errors++
      notes.push(`Probe 2 (tool calling): error — ${(e as Error).message}`)
    }
  }

  // Probe 3: brevity check.
  probes++
  try {
    const t0 = Date.now()
    const reply = await collectText(model, [
      { role: "user", content: "What is 2 + 2? Answer in one word." },
    ])
    latencies.push(Date.now() - t0)
    const trimmed = reply.trim()
    if (trimmed.length > 50) verboseByDefault = true
    if (trimmed.startsWith("4") || /\b4\b/.test(trimmed)) {
      notes.push(`Probe 3 (brevity): pass — ${trimmed.length} chars`)
    } else {
      notes.push(`Probe 3 (brevity): unexpected — got "${trimmed.slice(0, 80)}"`)
    }
  } catch (e) {
    errors++
    notes.push(`Probe 3 (brevity): error — ${(e as Error).message}`)
  }

  const averageLatencyMs =
    latencies.length === 0 ? 0 : latencies.reduce((s, n) => s + n, 0) / latencies.length

  return {
    modelId: model.id,
    probedAt: Date.now(),
    nativeToolCalls,
    followsInstructions,
    verboseByDefault,
    averageLatencyMs,
    errorRate: probes === 0 ? 0 : errors / probes,
    notes,
  }
}

async function collectText(
  model: ModelAdapter,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
): Promise<string> {
  const ac = new AbortController()
  let text = ""
  const mappedMessages = messages.map((m, i) => ({
    id: `p-${i}`,
    role: m.role,
    content: m.content,
    timestamp: Date.now(),
  }))
  for await (const ev of model.complete({
    messages: mappedMessages,
    tools: [],
    signal: ac.signal,
  })) {
    if (ev.type === "delta") text += ev.text
    else if (ev.type === "error") throw ev.error
    else if (ev.type === "done") break
  }
  return text
}

async function collectToolCalls(
  model: ModelAdapter,
  tools: ToolSchema[],
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
): Promise<{ text: string; toolCalls: Array<{ name: string; args: unknown }> }> {
  const ac = new AbortController()
  let text = ""
  const toolCalls: Array<{ name: string; args: unknown }> = []
  const mappedMessages = messages.map((m, i) => ({
    id: `p-${i}`,
    role: m.role,
    content: m.content,
    timestamp: Date.now(),
  }))
  for await (const ev of model.complete({
    messages: mappedMessages,
    tools,
    signal: ac.signal,
  })) {
    if (ev.type === "delta") text += ev.text
    else if (ev.type === "tool_call") toolCalls.push({ name: ev.call.name, args: ev.call.args })
    else if (ev.type === "error") throw ev.error
    else if (ev.type === "done") break
  }
  return { text, toolCalls }
}
