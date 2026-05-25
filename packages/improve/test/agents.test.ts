import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadAgents } from "../src/agents.ts"

let home: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.OMNI_HOME
  home = mkdtempSync(join(tmpdir(), "omni-agents-"))
  process.env.OMNI_HOME = home
})
afterEach(() => {
  if (prevHome === undefined) delete process.env.OMNI_HOME
  else process.env.OMNI_HOME = prevHome
  rmSync(home, { recursive: true, force: true })
})

function writeAgent(name: string, body: string): void {
  const dir = join(home, "agents", name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "AGENT.md"), body)
}

describe("loadAgents", () => {
  test("loads the three shipped defaults on an empty home", () => {
    const agents = loadAgents()
    expect([...agents.keys()].sort()).toEqual(["critique", "explore", "test"])
    const explore = agents.get("explore")!
    expect(explore.source).toBe("default")
    expect(explore.tools).toEqual(["read_file", "glob", "grep", "web_fetch"])
    expect(explore.systemPrompt.length).toBeGreaterThan(0)
  })

  test("parses JSON-frontmatter permission rules on the test agent", () => {
    const t = loadAgents().get("test")!
    expect(t.permissionDefault).toBe("deny")
    expect((t.permissions?.bash?.allow?.length ?? 0)).toBeGreaterThan(0)
    expect((t.permissions?.write_file?.allow?.length ?? 0)).toBeGreaterThan(0)
  })

  test("a user agent (JSON frontmatter) overrides a default of the same name", () => {
    writeAgent(
      "explore",
      `---\n{ "name": "explore", "description": "custom", "tools": ["read_file"] }\n---\nCustom explore.\n`,
    )
    const explore = loadAgents().get("explore")!
    expect(explore.source).toBe("user")
    expect(explore.description).toBe("custom")
    expect(explore.tools).toEqual(["read_file"])
  })

  test("name falls back to the directory when frontmatter omits it", () => {
    writeAgent("doc", `Just a body, no frontmatter.\n`)
    const doc = loadAgents().get("doc")!
    expect(doc.name).toBe("doc")
    expect(doc.systemPrompt).toBe("Just a body, no frontmatter.")
  })

  test("skips a directory without AGENT.md", () => {
    mkdirSync(join(home, "agents", "empty"), { recursive: true })
    expect(loadAgents().has("empty")).toBe(false)
  })
})
