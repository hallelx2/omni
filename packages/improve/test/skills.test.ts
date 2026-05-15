import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  loadSkills,
  findMatchingSkill,
  filterToolsBySkill,
  setFrontmatterParser,
  type Skill,
} from "../src/skills.ts"

let dir: string

// Tiny stand-in for the frontmatter parser. We're testing the skill loader,
// not the parser itself (that's covered in the CLI's user-commands tests).
function fakeFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!m) return { frontmatter: {}, body: raw }
  const fm: Record<string, unknown> = {}
  // Cheap parser: parse simple `key: value` lines + `triggers:` array
  const lines = m[1]!.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const kv = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/.exec(line)
    if (!kv) {
      i++
      continue
    }
    const key = kv[1]!
    const value = kv[2]!.trim()
    if (value === "") {
      const items: string[] = []
      i++
      while (i < lines.length && (lines[i]!.startsWith("  ") || lines[i] === "")) {
        const sub = lines[i]!.trim()
        if (sub.startsWith("- ")) items.push(sub.slice(2).replace(/^"|"$/g, ""))
        i++
      }
      fm[key] = items
    } else {
      fm[key] = value
      i++
    }
  }
  return { frontmatter: fm, body: m[2] ?? "" }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omni-skills-"))
  delete process.env.OMNI_HOME
  setFrontmatterParser(fakeFrontmatter)
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.OMNI_HOME
})

const mkSkill = (overrides: Partial<Skill> = {}): Skill => ({
  name: "test",
  description: "",
  triggers: [],
  systemPrompt: "",
  source: "user",
  path: "/tmp/test/SKILL.md",
  ...overrides,
})

describe("loadSkills", () => {
  test("empty when home is empty", () => {
    process.env.OMNI_HOME = dir
    expect(loadSkills(dir).size).toBe(0)
  })

  test("loads a skill from ~/.omni/skills/<name>/SKILL.md", async () => {
    process.env.OMNI_HOME = dir
    await mkdir(join(dir, "skills", "tester"), { recursive: true })
    await writeFile(
      join(dir, "skills", "tester", "SKILL.md"),
      `---
name: tester
description: Run tests
triggers:
  - "test this"
---
You are a tester.`,
    )
    const skills = loadSkills(dir)
    expect(skills.has("tester")).toBe(true)
    expect(skills.get("tester")!.description).toBe("Run tests")
    expect(skills.get("tester")!.systemPrompt).toBe("You are a tester.")
    expect(skills.get("tester")!.triggers).toEqual(["test this"])
  })

  test("falls back to directory name when frontmatter.name missing", async () => {
    process.env.OMNI_HOME = dir
    await mkdir(join(dir, "skills", "auto-named"), { recursive: true })
    await writeFile(join(dir, "skills", "auto-named", "SKILL.md"), "body")
    const skills = loadSkills(dir)
    expect(skills.has("auto-named")).toBe(true)
  })

  test("ignores directories without SKILL.md", async () => {
    process.env.OMNI_HOME = dir
    await mkdir(join(dir, "skills", "no-skill"), { recursive: true })
    await writeFile(join(dir, "skills", "no-skill", "README.md"), "wrong file")
    expect(loadSkills(dir).size).toBe(0)
  })

  test("workspace skills override user skills by name", async () => {
    process.env.OMNI_HOME = join(dir, "home")
    await mkdir(join(dir, "home", "skills", "review"), { recursive: true })
    await writeFile(
      join(dir, "home", "skills", "review", "SKILL.md"),
      `---
name: review
---
user version`,
    )
    await mkdir(join(dir, "ws", ".omni", "skills", "review"), { recursive: true })
    await writeFile(
      join(dir, "ws", ".omni", "skills", "review", "SKILL.md"),
      `---
name: review
---
workspace version`,
    )
    const skills = loadSkills(join(dir, "ws"))
    expect(skills.get("review")!.systemPrompt).toBe("workspace version")
    expect(skills.get("review")!.source).toBe("workspace")
  })
})

describe("findMatchingSkill", () => {
  test("matches by substring trigger", () => {
    const skill = mkSkill({ name: "writer", triggers: ["write a test"] })
    expect(findMatchingSkill("please write a test for this", [skill])).toBe(skill)
  })

  test("case insensitive", () => {
    const skill = mkSkill({ name: "writer", triggers: ["WRITE"] })
    expect(findMatchingSkill("write something", [skill])).toBe(skill)
  })

  test("returns null when nothing matches", () => {
    const skill = mkSkill({ name: "writer", triggers: ["foo"] })
    expect(findMatchingSkill("bar baz", [skill])).toBeNull()
  })

  test("workspace skills win over user skills with the same trigger", () => {
    const user = mkSkill({ name: "shared", triggers: ["x"], source: "user", systemPrompt: "user" })
    const ws = mkSkill({ name: "shared2", triggers: ["x"], source: "workspace", systemPrompt: "ws" })
    expect(findMatchingSkill("x here", [user, ws])).toBe(ws)
  })

  test("first match wins among same-source skills", () => {
    const a = mkSkill({ name: "a", triggers: ["match"] })
    const b = mkSkill({ name: "b", triggers: ["match"] })
    expect(findMatchingSkill("match", [a, b])).toBe(a)
  })
})

describe("filterToolsBySkill", () => {
  test("returns all tools when skill has no toolsOnly", () => {
    const skill = mkSkill()
    const tools = [{ name: "a" }, { name: "b" }]
    expect(filterToolsBySkill(tools, skill)).toEqual(tools)
  })

  test("filters down to allowed tools when toolsOnly is set", () => {
    const skill = mkSkill({ toolsOnly: ["a", "c"] })
    const tools = [{ name: "a" }, { name: "b" }, { name: "c" }]
    expect(filterToolsBySkill(tools, skill).map((t) => t.name)).toEqual(["a", "c"])
  })

  test("empty toolsOnly filters everything", () => {
    const skill = mkSkill({ toolsOnly: [] })
    expect(filterToolsBySkill([{ name: "a" }], skill)).toEqual([])
  })
})
