/**
 * `@omni/improve` — the third brain and super-legs of the harness.
 *
 *   Third brain:
 *     - {@link Planner}: decomposes user tasks before execution
 *     - {@link Critic}:  reviews assistant turns and tool results
 *     - {@link Memory}:  long-term knowledge across sessions
 *
 *   Super legs (Aspect 8, this file as it grows):
 *     - Probe:  capability detection per model
 *     - Adapt:  pick prompts/strategies that fit the model
 *     - Traces: persisted run logs that fuel evolution
 *     - Evolve: A/B test prompt variants on real traces
 */

export { Planner, parsePlan, renderPlan } from "./planner.ts"
export type { Plan, PlanStep, PlannerOptions } from "./planner.ts"

export { Critic, parseCritique } from "./critic.ts"
export type { Critique, CritiqueVerdict, CriticOptions } from "./critic.ts"

export { Memory } from "./memory.ts"
export type { MemoryEntry, MemoryKind } from "./memory.ts"

export { probeModel, probeModelCached, InMemoryProfileCache } from "./probe.ts"
export type {
  ModelProfile,
  ProbeOptions,
  ProfileCache,
  ProbeCacheOptions,
} from "./probe.ts"

export { SqliteProfileCache } from "./sqlite-cache.ts"

export {
  loadSkills,
  findMatchingSkill,
  filterToolsBySkill,
  setFrontmatterParser,
} from "./skills.ts"
export type { Skill } from "./skills.ts"

export { adapt } from "./adapt.ts"
export type { AdaptedStrategy } from "./adapt.ts"

export { FileTracer, scoreTrace, readTrace } from "./traces.ts"
export type { TraceLine } from "./traces.ts"

export { replayTrace, checkTrace } from "./replay.ts"
export type { ReplayChecks } from "./replay.ts"

export {
  emptyPool,
  addVariant,
  recordTrial,
  fitness,
  tournamentSelect,
  mutatePrompt,
} from "./evolve.ts"
export type { PromptVariant, VariantPool } from "./evolve.ts"
