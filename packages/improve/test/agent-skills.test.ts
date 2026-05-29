import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadAgents, routeAgents } from "../src/agents.ts"
import { loadSkills, skillSearchRoots, type Skill } from "../src/skills.ts"
import { renderSkillForAgent } from "../src/skill-loader.ts"

let home: string
let prevHome: string | undefined
let prevRoots: string | undefined

let prevClaude: string | undefined
beforeEach(() => {
  prevHome = process.env.OMNI_HOME
  prevRoots = process.env.OMNI_SKILL_ROOTS
  prevClaude = process.env.OMNI_CLAUDE_SKILLS_DIR
  process.env.OMNI_CLAUDE_SKILLS_DIR = "" // hermetic: ignore the real ~/.claude/skills
  home = mkdtempSync(join(tmpdir(), "omni-askills-"))
  process.env.OMNI_HOME = home
})
afterEach(() => {
  if (prevHome === undefined) delete process.env.OMNI_HOME
  else process.env.OMNI_HOME = prevHome
  if (prevRoots === undefined) delete process.env.OMNI_SKILL_ROOTS
  else process.env.OMNI_SKILL_ROOTS = prevRoots
  if (prevClaude === undefined) delete process.env.OMNI_CLAUDE_SKILLS_DIR
  else process.env.OMNI_CLAUDE_SKILLS_DIR = prevClaude
  rmSync(home, { recursive: true, force: true })
})

const fakeSkill = (over: Partial<Skill> = {}): Skill => ({
  name: "demo",
  description: "A demo skill",
  triggers: [],
  systemPrompt: "Do the demo thing.",
  source: "user",
  path: join(home, "skills", "demo", "SKILL.md"),
  ...over,
})

describe("agent frontmatter — new fields", () => {
  test("parses skills/languages/domains/context/skillResources (langs lowercased)", () => {
    const dir = join(home, "agents", "custom")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "AGENT.md"),
      `---\n${JSON.stringify({
        name: "custom",
        skills: ["frontend-design"],
        languages: ["TypeScript", "Python"],
        domains: ["Frontend"],
        context: ["context/notes.md"],
        skillResources: "full",
      })}\n---\nbody`,
    )
    const a = loadAgents().get("custom")!
    expect(a.skills).toEqual(["frontend-design"])
    expect(a.languages).toEqual(["typescript", "python"])
    expect(a.domains).toEqual(["frontend"])
    expect(a.context).toEqual(["context/notes.md"])
    expect(a.skillResources).toBe("full")
  })

  test("skillResources coerces unknown values to undefined (default summary downstream)", () => {
    const dir = join(home, "agents", "weird")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "AGENT.md"), `---\n${JSON.stringify({ name: "weird", skillResources: "bogus" })}\n---\nb`)
    expect(loadAgents().get("weird")!.skillResources).toBeUndefined()
  })
})

describe("routeAgents", () => {
  test("ranks the matching specialized agent first", () => {
    const agents = loadAgents()
    const top = (task: string) => routeAgents(task, agents.values())[0]?.agent
    expect(top("build a React dashboard component")).toBe("frontend-engineer")
    expect(top("write a FastAPI endpoint with pydantic")).toBe("backend-python")
    expect(top("add a Go gRPC handler")).toBe("backend-go")
    expect(top("build a dbt incremental model and Airflow DAG")).toBe("data-engineer")
  })

  test("no hint match → empty (caller falls back to the general engine)", () => {
    expect(routeAgents("please refactor this", loadAgents().values())).toEqual([])
  })
})

describe("renderSkillForAgent", () => {
  test("summary mode inlines the body + name + description", () => {
    const out = renderSkillForAgent(fakeSkill(), "summary")
    expect(out).toContain("## Skill: demo")
    expect(out).toContain("A demo skill")
    expect(out).toContain("Do the demo thing.")
  })

  test("caps an oversized body", () => {
    const out = renderSkillForAgent(fakeSkill({ systemPrompt: "x".repeat(50_000) }), "summary")
    expect(out).toContain("truncated")
    expect(out.length).toBeLessThan(30_000)
  })
})

describe("skillSearchRoots", () => {
  test("includes an OMNI_SKILL_ROOTS dir and loads skills from it", () => {
    const extra = mkdtempSync(join(tmpdir(), "omni-extraskills-"))
    const sdir = join(extra, "extra-skill")
    mkdirSync(sdir, { recursive: true })
    writeFileSync(join(sdir, "SKILL.md"), "---\nname: extra-skill\n---\nExtra body")
    process.env.OMNI_SKILL_ROOTS = extra
    try {
      expect(skillSearchRoots().some((r) => r.dir === extra)).toBe(true)
      expect(loadSkills().has("extra-skill")).toBe(true)
    } finally {
      rmSync(extra, { recursive: true, force: true })
    }
  })
})
