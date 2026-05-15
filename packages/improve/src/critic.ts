import { generateObject } from "ai"
import { z } from "zod"
import type { ModelAdapter, Message } from "@omni/core"

export type CritiqueVerdict = "ok" | "concern" | "fail"

export interface Critique {
  readonly verdict: CritiqueVerdict
  readonly score: number // 0-1
  readonly issues: readonly string[]
  readonly raw: string
}

export interface CriticOptions {
  readonly systemPrompt?: string
  /** When verdict is `fail` AND score below this, suggest retrying. Default 0.4. */
  readonly retryBelow?: number
  /** Use generateObject when set; falls back to text parsing on errors. */
  readonly useStructuredOutput?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly languageModel?: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly providerOptions?: Record<string, any>
}

const CritiqueSchema = z.object({
  verdict: z.enum(["ok", "concern", "fail"]),
  score: z.number().min(0).max(1),
  issues: z.array(z.string()),
})

export class Critic {
  constructor(
    private readonly model: ModelAdapter,
    private readonly options: CriticOptions = {},
  ) {}

  async reviewMessages(messages: readonly Message[]): Promise<Critique> {
    const transcript = messages
      .map((m) => `[${m.role}] ${m.content}${m.toolCalls ? ` (tool: ${m.toolCalls.map((c) => c.name).join(",")})` : ""}`)
      .join("\n")
    const userMsg = `Review the following agent transcript and judge the quality of the assistant's response.\n\nTranscript:\n${transcript}`
    return this._ask(userMsg)
  }

  async reviewToolResult(
    toolName: string,
    args: unknown,
    result: unknown,
    expectation: string,
  ): Promise<Critique> {
    const userMsg = `Review whether a tool result satisfies an expectation.

Tool: ${toolName}
Args: ${JSON.stringify(args).slice(0, 1000)}
Result: ${typeof result === "string" ? result.slice(0, 2000) : JSON.stringify(result).slice(0, 2000)}
Expectation: ${expectation}`
    return this._ask(userMsg)
  }

  shouldRetry(c: Critique): boolean {
    return c.verdict === "fail" && c.score < (this.options.retryBelow ?? 0.4)
  }

  private async _ask(userMsg: string): Promise<Critique> {
    if (this.options.useStructuredOutput && this.options.languageModel) {
      try {
        return await this._askStructured(userMsg)
      } catch {
        // fall through to text parsing on structured failure
      }
    }
    return await this._askText(userMsg)
  }

  private async _askStructured(userMsg: string): Promise<Critique> {
    const system =
      this.options.systemPrompt ??
      `You are a strict critic of agent behavior. Judge whether an assistant turn or tool result is correct, helpful, and matches the user's request.`
    const result = await generateObject({
      model: this.options.languageModel,
      schema: CritiqueSchema,
      system,
      prompt: userMsg,
      ...(this.options.providerOptions ? { providerOptions: this.options.providerOptions } : {}),
    })
    return {
      verdict: result.object.verdict,
      score: result.object.score,
      issues: result.object.issues,
      raw: JSON.stringify(result.object),
    }
  }

  private async _askText(userMsg: string): Promise<Critique> {
    const system =
      this.options.systemPrompt ??
      `You are a strict critic of agent behavior. You judge whether an assistant turn or tool result is correct, helpful, and matches the user's request. Always answer in the exact format requested.`

    const formatInstr = `Respond on exactly two lines:
  Line 1: VERDICT=<ok|concern|fail> SCORE=<0.0-1.0>
  Line 2: ISSUES: <semicolon-separated concerns, or NONE>`

    const messages = [
      { id: "c-sys", role: "system" as const, content: system, timestamp: Date.now() },
      { id: "c-user", role: "user" as const, content: `${userMsg}\n\n${formatInstr}`, timestamp: Date.now() },
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
    return parseCritique(text)
  }
}

const VERDICT_RE = /VERDICT\s*=\s*(ok|concern|fail)/i
const SCORE_RE = /SCORE\s*=\s*(-?\d+(?:\.\d+)?)/i
const ISSUES_RE = /ISSUES\s*:\s*(.+)/i

export function parseCritique(raw: string): Critique {
  const v = VERDICT_RE.exec(raw)
  const s = SCORE_RE.exec(raw)
  const i = ISSUES_RE.exec(raw)
  const verdict = ((v?.[1] ?? "concern").toLowerCase() as CritiqueVerdict)
  const parsedScore = s ? parseFloat(s[1]!) : 0.5
  const score = Number.isFinite(parsedScore) ? Math.max(0, Math.min(1, parsedScore)) : 0.5
  const issuesRaw = (i?.[1] ?? "").trim()
  const issues =
    issuesRaw && issuesRaw.toUpperCase() !== "NONE"
      ? issuesRaw.split(";").map((x) => x.trim()).filter(Boolean)
      : []
  return { verdict, score, issues, raw }
}
