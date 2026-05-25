/// <reference path="./md.d.ts" />
/**
 * Repo-shipped default agents, embedded as text so they survive
 * `bun build --compile` (the compiled binary has no source tree on disk).
 * Physical AGENT.md files under ./defaults/<name>/ remain the human-editable
 * source of truth; this module is the runtime carrier.
 */
import exploreMd from "./defaults/explore/AGENT.md" with { type: "text" }
import testMd from "./defaults/test/AGENT.md" with { type: "text" }
import critiqueMd from "./defaults/critique/AGENT.md" with { type: "text" }

export interface DefaultAgentFile {
  readonly name: string
  readonly raw: string
}

export const DEFAULT_AGENT_FILES: readonly DefaultAgentFile[] = [
  { name: "explore", raw: exploreMd },
  { name: "test", raw: testMd },
  { name: "critique", raw: critiqueMd },
]
