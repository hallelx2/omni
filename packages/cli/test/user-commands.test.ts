import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  parseArgs,
  parseFrontmatter,
  renderCommand,
  loadUserCommands,
  type UserCommand,
} from "../src/user-commands.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omni-uc-"))
  delete process.env.OMNI_HOME
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.OMNI_HOME
})

describe("parseArgs", () => {
  test("plain words", () => {
    expect(parseArgs("a b c")).toEqual(["a", "b", "c"])
  })

  test("double-quoted strings", () => {
    expect(parseArgs('a "b c" d')).toEqual(["a", "b c", "d"])
  })

  test("single-quoted strings", () => {
    expect(parseArgs("a 'b c' d")).toEqual(["a", "b c", "d"])
  })

  test("escaped quote", () => {
    expect(parseArgs(`"she said \\"hi\\""`)).toEqual([`she said "hi"`])
  })

  test("multiple whitespace", () => {
    expect(parseArgs("a   b\tc")).toEqual(["a", "b", "c"])
  })

  test("empty input", () => {
    expect(parseArgs("")).toEqual([])
    expect(parseArgs("   ")).toEqual([])
  })
})

describe("parseFrontmatter", () => {
  test("no frontmatter → empty fm, full body", () => {
    const r = parseFrontmatter("hello world")
    expect(r.frontmatter).toEqual({})
    expect(r.body).toBe("hello world")
  })

  test("scalar key/value", () => {
    const r = parseFrontmatter("---\nname: test\ndescription: hello\n---\nBody")
    expect(r.frontmatter.name).toBe("test")
    expect(r.frontmatter.description).toBe("hello")
    expect(r.body).toBe("Body")
  })

  test("list of objects", () => {
    const r = parseFrontmatter(`---
name: cmd
args:
  - name: scope
    optional: true
  - name: type
---
body`)
    expect(r.frontmatter.args).toEqual([
      { name: "scope", optional: true },
      { name: "type" },
    ])
  })

  test("JSON frontmatter escape hatch", () => {
    const r = parseFrontmatter(`---
{"name": "test", "args": [{"name": "x"}]}
---
body`)
    expect(r.frontmatter.name).toBe("test")
    expect(r.frontmatter.args).toEqual([{ name: "x" }])
  })

  test("booleans, numbers, null", () => {
    const r = parseFrontmatter("---\na: true\nb: 42\nc: null\n---\n")
    expect(r.frontmatter).toEqual({ a: true, b: 42, c: null } as never)
  })
})

const mkCmd = (overrides: Partial<UserCommand> = {}): UserCommand => ({
  name: "test",
  description: "",
  args: [],
  template: "",
  source: "user",
  path: "/tmp/test.md",
  ...overrides,
})

describe("renderCommand", () => {
  test("substitutes $ARGS", () => {
    const cmd = mkCmd({ template: "do: {{$ARGS}}" })
    expect(renderCommand(cmd, ["a", "b"])).toBe("do: a b")
  })

  test("substitutes positional", () => {
    const cmd = mkCmd({ template: "first={{1}} second={{2}}" })
    expect(renderCommand(cmd, ["alpha", "beta"])).toBe("first=alpha second=beta")
  })

  test("substitutes named via frontmatter", () => {
    const cmd = mkCmd({
      template: "scope={{scope}}",
      args: [{ name: "scope" }],
    })
    expect(renderCommand(cmd, ["auth"])).toBe("scope=auth")
  })

  test("conditional block when var is set", () => {
    const cmd = mkCmd({
      template: "msg{{#scope}} ({{scope}}){{/scope}}: ok",
      args: [{ name: "scope" }],
    })
    expect(renderCommand(cmd, ["auth"])).toBe("msg (auth): ok")
  })

  test("conditional block omitted when var is missing", () => {
    const cmd = mkCmd({
      template: "msg{{#scope}} ({{scope}}){{/scope}}: ok",
      args: [{ name: "scope" }],
    })
    expect(renderCommand(cmd, [])).toBe("msg: ok")
  })

  test("unknown placeholders become empty", () => {
    const cmd = mkCmd({ template: "x={{unknown}}" })
    expect(renderCommand(cmd, [])).toBe("x=")
  })
})

describe("loadUserCommands", () => {
  test("returns empty when home dir is empty", () => {
    process.env.OMNI_HOME = dir
    const cmds = loadUserCommands(dir)
    expect(cmds.size).toBe(0)
  })

  test("loads .md files from ~/.omni/commands/", async () => {
    process.env.OMNI_HOME = dir
    await mkdir(join(dir, "commands"), { recursive: true })
    await writeFile(
      join(dir, "commands", "hello.md"),
      "---\nname: hello\ndescription: greet\n---\nSay hello to {{1}}",
    )
    const cmds = loadUserCommands(dir)
    expect(cmds.has("hello")).toBe(true)
    expect(cmds.get("hello")!.description).toBe("greet")
    expect(cmds.get("hello")!.template).toContain("{{1}}")
  })

  test("falls back to filename when frontmatter.name absent", async () => {
    process.env.OMNI_HOME = dir
    await mkdir(join(dir, "commands"), { recursive: true })
    await writeFile(join(dir, "commands", "auto-named.md"), "body only")
    const cmds = loadUserCommands(dir)
    expect(cmds.has("auto-named")).toBe(true)
  })

  test("workspace commands override user commands by name", async () => {
    process.env.OMNI_HOME = join(dir, "home")
    await mkdir(join(dir, "home", "commands"), { recursive: true })
    await writeFile(
      join(dir, "home", "commands", "ship.md"),
      "---\nname: ship\n---\nuser ship",
    )
    const wsDir = join(dir, "project", ".omni", "commands")
    await mkdir(wsDir, { recursive: true })
    await writeFile(
      join(wsDir, "ship.md"),
      "---\nname: ship\n---\nworkspace ship",
    )
    const cmds = loadUserCommands(join(dir, "project"))
    expect(cmds.get("ship")!.template).toBe("workspace ship")
    expect(cmds.get("ship")!.source).toBe("workspace")
  })

  test("skips non-md files", async () => {
    process.env.OMNI_HOME = dir
    await mkdir(join(dir, "commands"), { recursive: true })
    await writeFile(join(dir, "commands", "ignored.txt"), "x")
    await writeFile(join(dir, "commands", "kept.md"), "---\nname: kept\n---\nbody")
    const cmds = loadUserCommands(dir)
    expect(cmds.has("kept")).toBe(true)
    expect(cmds.has("ignored")).toBe(false)
  })
})
