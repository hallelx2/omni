import { z } from "zod"
import type { Tool, ToolContext } from "@omni/core"
import type { ModalQueue } from "./modals/index.ts"

const AskUserArgs = z.object({
  question: z.string().min(1).describe("One short sentence; the question to ask the user."),
  context: z
    .string()
    .optional()
    .describe("Optional one-line explanation under the question."),
  options: z
    .array(
      z.object({
        key: z
          .string()
          .min(1)
          .max(1)
          .describe("Single-char keyboard shortcut for this option."),
        label: z.string().min(1).describe("Short label (1-5 words)."),
        description: z
          .string()
          .optional()
          .describe("Sentence shown under the label when focused."),
        value: z
          .string()
          .min(1)
          .describe("The value returned to the model when the user picks this option."),
      }),
    )
    .min(2)
    .max(8)
    .describe("Options to offer the user. 2-8 entries."),
  allow_other: z
    .boolean()
    .optional()
    .describe("When true (default), the user can type a free-text answer instead. Default true."),
})

export interface AskUserResult {
  readonly answer: string
  readonly source: "option" | "other" | "cancelled"
}

/**
 * Agent-callable: stops the run and asks the user a question with
 * up-to-eight pre-defined options (plus optional free-text "other").
 *
 * The agent should use this for clarifying questions and irreversible
 * branching decisions — NOT as a substitute for thinking. Each call
 * costs a user round-trip.
 */
export function createAskUserTool(modals: ModalQueue): Tool<z.infer<typeof AskUserArgs>, AskUserResult> {
  return {
    name: "ask_user",
    description:
      "Ask the user a clarifying question and wait for their answer. Use sparingly — only when you genuinely need a decision the user must make.",
    permission: "auto", // The modal IS the permission gate; no need to double-prompt.
    schema: AskUserArgs,
    async execute(args, _ctx: ToolContext): Promise<AskUserResult> {
      const picked = await modals.push({
        kind: "question",
        question: args.question,
        context: args.context,
        options: args.options.map((o) => ({
          key: o.key,
          label: o.label,
          description: o.description,
          value: o.value,
        })),
        allowOther: args.allow_other,
      })
      if (picked === null) return { answer: "", source: "cancelled" }
      const fromOption = args.options.find((o) => o.value === picked)
      return {
        answer: picked,
        source: fromOption ? "option" : "other",
      }
    },
  }
}
