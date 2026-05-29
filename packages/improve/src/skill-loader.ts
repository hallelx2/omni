import { dirname, join, relative } from "node:path"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import type { Skill } from "./skills.ts"

/**
 * Render a loaded {@link Skill} into a system-prompt block for a specialized
 * subagent. The skill body IS the operating guide; in "full" mode the skill's
 * `references/*.md` resources are inlined too. Everything is hard-capped so a
 * large skill can't blow the child's context window.
 *
 * Attaching a skill NEVER widens an agent's tool set — the agent's `tools`
 * allowlist remains the only security boundary (enforced by agentPermissionGate).
 * A skill's content is guidance, not capability.
 */

const MAX_SKILL_BYTES = 24_000
const MAX_RESOURCE_BYTES = 8_000
const RESOURCE_DIRS = ["references", "reference", "docs"] as const

function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + `\n…[truncated ${s.length - max} chars]`
}

/** Render one skill as a prompt block. */
export function renderSkillForAgent(skill: Skill, mode: "summary" | "full"): string {
  const head = `## Skill: ${skill.name}\n${skill.description}\n`
  const body = clip(skill.systemPrompt, MAX_SKILL_BYTES)
  if (mode === "summary") return head + "\n" + body

  // "full": also inline reference resources sitting beside SKILL.md.
  const dir = dirname(skill.path)
  const refs: string[] = []
  for (const sub of RESOURCE_DIRS) {
    const rdir = join(dir, sub)
    try {
      if (!existsSync(rdir) || !statSync(rdir).isDirectory()) continue
      for (const f of readdirSync(rdir)) {
        if (!f.endsWith(".md")) continue
        const p = join(rdir, f)
        refs.push(`### ${relative(dir, p)}\n` + clip(readFileSync(p, "utf8"), MAX_RESOURCE_BYTES))
      }
    } catch {
      // a missing/unreadable resource dir is non-fatal — skip it
    }
  }
  return head + "\n" + body + (refs.length ? "\n\n" + refs.join("\n\n") : "")
}
