import { ulid } from "ulid"
import { zodToJsonSchema } from "zod-to-json-schema"
import type { JSONSchema7 } from "json-schema"
import type { Tool, ToolCall, ToolSchema } from "./types.ts"

/** Outcome of validating a tool call's arguments against its schema. */
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string }

/**
 * Validate tool call arguments against the tool's Zod schema.
 *
 * Tolerates `call.args` as either an object or a JSON string (some adapters
 * deliver function-call arguments as a stringified payload). On failure,
 * returns a precise, model-readable error so the next turn can correct itself.
 */
export function validateToolCall(tool: Tool, call: ToolCall): ValidationResult<unknown> {
  let candidate: unknown = call.args
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate)
    } catch {
      // Leave as-is; schema will reject with a clear error.
    }
  }

  const parsed = tool.schema.safeParse(candidate)
  if (parsed.success) return { ok: true, value: parsed.data }

  const issues = parsed.error.issues
    .map((i) => {
      const path = i.path.length ? i.path.join(".") : "(root)"
      return `${path}: ${i.message}`
    })
    .join("; ")
  return { ok: false, reason: `Invalid arguments for ${tool.name}: ${issues}` }
}

/**
 * Convert a Tool's Zod schema into a JSON Schema (draft-07) the adapter
 * passes to the provider. Uses `zod-to-json-schema` to handle the long tail
 * (unions, literals, nullables, enums, refinements) faithfully.
 */
export function toToolSchema(tool: Tool): ToolSchema {
  // target: "jsonSchema7" emits the draft-07 numeric form of
  // exclusiveMinimum/exclusiveMaximum (what OpenAI and most modern providers
  // accept). "openApi3" emits the draft-04 boolean form which MiMo's
  // validator (and others) reject as invalid.
  const parameters = zodToJsonSchema(tool.schema, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as JSONSchema7
  return {
    name: tool.name,
    description: tool.description,
    parameters,
  }
}

/**
 * ReAct-style fallback: extract a synthetic ToolCall from a model's assistant
 * text when native function calling failed or is unavailable.
 *
 * Recognizes the canonical pattern:
 *
 * ```
 * Thought: ...
 * Action: <tool_name>
 * Action Input: <json-or-text>
 * ```
 *
 * Used by the engine when {@link EngineConfig.enableReActFallback} is true
 * and the model emitted no native tool_calls.
 */
const REACT_PATTERN =
  /Action:\s*([\w.-]+)\s*\n\s*Action Input:\s*([\s\S]+?)(?=\n\s*(?:Action:|Observation:|Thought:|Final Answer:)|$)/

export function parseReActFallback(
  assistantText: string,
  id: () => string = ulid,
): ToolCall | null {
  const match = REACT_PATTERN.exec(assistantText)
  if (!match) return null
  const name = match[1]
  const rawArgs = match[2]
  if (!name || rawArgs === undefined) return null

  const trimmed = rawArgs.trim()
  let args: unknown
  try {
    args = JSON.parse(trimmed)
  } catch {
    args = { input: trimmed }
  }
  return { id: id(), name, args }
}
