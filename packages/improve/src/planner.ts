import type { ModelAdapter, ToolMeta } from "@omni/core"

export interface PlanStep {
  readonly index: number
  readonly action: string
  readonly tool?: string
  readonly rationale?: string
}

export interface Plan {
  readonly task: string
  readonly steps: readonly PlanStep[]
  readonly raw: string
}

export interface PlannerOptions {
  readonly maxSteps?: number
  readonly systemPrompt?: string
}

/**
 * Decomposes a user task into ordered steps before the execution model
 * sees it. For weak models, having an explicit plan dramatically improves
 * reliability — instead of "figure out what to do AND do it", they only
 * need to "execute step N".
 *
 * The planner may use a stronger model than the executor (e.g. Claude plans,
 * MiMo executes) by passing a different `ModelAdapter`.
 *
 * The output is parsed defensively: malformed responses still surface as a
 * single-step plan containing the raw text. Callers can use `plan.steps`
 * directly or fall back to `plan.raw`.
 */
export class Planner {
  constructor(
    private readonly model: ModelAdapter,
    private readonly options: PlannerOptions = {},
  ) {}

  async plan(task: string, tools: readonly ToolMeta[] = []): Promise<Plan> {
    const maxSteps = this.options.maxSteps ?? 8
    const system =
      this.options.systemPrompt ??
      `You are a planner. Given a user task and available tools, output a numbered list of concrete steps that will accomplish the task.

Rules:
- Output ONLY the numbered steps, one per line.
- Each step starts with "N." and is a single concise sentence.
- Where a tool will be used, mention it in parentheses: "(uses bash)".
- Maximum ${maxSteps} steps.
- Do not include explanations, preamble, or trailing notes.`

    const toolsBlock =
      tools.length === 0
        ? ""
        : "\n\nAvailable tools:\n" + tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")

    const userMsg = `Task: ${task}${toolsBlock}\n\nReturn the numbered steps now.`

    const messages = [
      { id: "p-sys", role: "system" as const, content: system, timestamp: Date.now() },
      { id: "p-user", role: "user" as const, content: userMsg, timestamp: Date.now() },
    ]
    const ac = new AbortController()
    let text = ""
    for await (const ev of this.model.complete({
      messages,
      tools: [],
      signal: ac.signal,
    })) {
      if (ev.type === "delta") text += ev.text
      else if (ev.type === "error") throw ev.error
      else if (ev.type === "done") break
    }

    return parsePlan(task, text, maxSteps)
  }
}

const STEP_RE = /^\s*(\d+)[.)]\s+(.+)$/
const TOOL_RE = /\(uses?\s+([a-zA-Z0-9_]+)\)/i

export function parsePlan(task: string, raw: string, maxSteps: number): Plan {
  const lines = raw.split(/\r?\n/)
  const steps: PlanStep[] = []
  for (const line of lines) {
    const m = STEP_RE.exec(line)
    if (!m) continue
    const action = (m[2] ?? "").trim()
    if (!action) continue
    const tm = TOOL_RE.exec(action)
    steps.push({
      index: steps.length + 1,
      action,
      tool: tm?.[1],
    })
    if (steps.length >= maxSteps) break
  }
  if (steps.length === 0 && raw.trim()) {
    steps.push({ index: 1, action: raw.trim().slice(0, 500) })
  }
  return { task, steps, raw }
}

/** Render a plan as a single string suitable for prepending to a system prompt. */
export function renderPlan(plan: Plan): string {
  if (plan.steps.length === 0) return ""
  return (
    `Plan for: ${plan.task}\n` +
    plan.steps.map((s) => `${s.index}. ${s.action}`).join("\n")
  )
}
