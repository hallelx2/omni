import type { ModelProfile } from "./probe.ts"

/**
 * Execution strategy chosen for a model based on its {@link ModelProfile}.
 * Consumed by orchestration code that builds an EngineConfig.
 */
export interface AdaptedStrategy {
  readonly systemPrompt: string
  /** Enable the engine's Action:/Action Input: ReAct fallback. */
  readonly enableReActFallback: boolean
  /** How tight to keep the iteration budget. */
  readonly maxIterations: number
  /** When true, use a planner before running the executor model. */
  readonly usePlanner: boolean
  /** When true, run the critic on each turn. */
  readonly useCritic: boolean
  /** Reserve more tokens for output when the model tends to be verbose. */
  readonly reserveOutputTokens: number
  /** Notes explaining each choice — useful for traces. */
  readonly rationale: readonly string[]
}

const BASE_PROMPT = `You are Omni, an autonomous coding agent. Use the available tools to gather information and complete the user's task. Be terse; do not narrate what you are about to do. When you finish, give a brief final answer.`

const STRUCTURED_PROMPT = `You are Omni, an autonomous coding agent.

Operating rules:
1. Use ONE tool per turn. Wait for its result before deciding the next.
2. After receiving a tool result, decide: call another tool OR write a final answer.
3. When writing a final answer, do NOT call any more tools.
4. Be terse. Do not narrate your reasoning to the user.

When you need to act, emit a tool call. When you are done, write the final answer.`

const REACT_PROMPT = `You are Omni, an autonomous coding agent.

When you need to act, respond in this exact format:
  Thought: <your reasoning>
  Action: <tool_name>
  Action Input: <JSON arguments>

Wait for the Observation, then either continue with another Thought/Action, or finish with:
  Final Answer: <your final response>

Be terse.`

/**
 * Pick an execution strategy that compensates for the probed model's
 * weaknesses. Conservative by default — better to enable extra safety than
 * have the harness fight the model.
 */
export function adapt(profile: ModelProfile): AdaptedStrategy {
  const rationale: string[] = []
  let systemPrompt = BASE_PROMPT
  let enableReActFallback = false
  let usePlanner = false
  let useCritic = false
  let maxIterations = 25
  let reserveOutputTokens = 4_096

  if (!profile.nativeToolCalls) {
    systemPrompt = REACT_PROMPT
    enableReActFallback = true
    rationale.push("nativeToolCalls=false → use ReAct prompting + engine fallback parser")
  } else if (!profile.followsInstructions) {
    systemPrompt = STRUCTURED_PROMPT
    rationale.push("followsInstructions=false → use stricter step-by-step prompt")
  }

  if (profile.verboseByDefault) {
    reserveOutputTokens = 8_192
    rationale.push("verboseByDefault=true → reserve 8K output tokens")
  }

  if (profile.errorRate > 0.3) {
    useCritic = true
    maxIterations = 15
    rationale.push("errorRate>0.3 → enable critic and tighten iterations")
  }

  if (!profile.followsInstructions && !profile.nativeToolCalls) {
    usePlanner = true
    rationale.push("instruction-poor + no native tools → planner decomposes the task first")
  }

  return {
    systemPrompt,
    enableReActFallback,
    maxIterations,
    usePlanner,
    useCritic,
    reserveOutputTokens,
    rationale,
  }
}
