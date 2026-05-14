import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { grep } from "../src/grep.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omni-grep-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function ctx() {
  return { cwd: dir, signal: new AbortController().signal }
}

describe("grep", () => {
  test("finds literal matches with line+column", async () => {
    await writeFile(join(dir, "a.txt"), "hello\nworld\nhello again\n")
    const r = await grep.execute({ pattern: "hello" }, ctx())
    expect(r.count).toBe(2)
    expect(r.matches[0]?.line).toBe(1)
    expect(r.matches[0]?.column).toBe(1)
    expect(r.matches[1]?.line).toBe(3)
  })

  test("supports regex patterns", async () => {
    await writeFile(join(dir, "a.txt"), "a1\nb2\nc3\n")
    const r = await grep.execute({ pattern: "[a-c]\\d" }, ctx())
    expect(r.count).toBe(3)
  })

  test("respects case_insensitive", async () => {
    await writeFile(join(dir, "a.txt"), "Hello\nWORLD\n")
    const r = await grep.execute({ pattern: "hello", case_insensitive: true }, ctx())
    expect(r.count).toBe(1)
  })

  test("glob filter restricts files", async () => {
    await writeFile(join(dir, "a.ts"), "match")
    await writeFile(join(dir, "a.md"), "match")
    const r = await grep.execute({ pattern: "match", glob: "**/*.ts" }, ctx())
    expect(r.matches.map((m) => m.file)).toEqual(["a.ts"])
  })

  test("skips binary files", async () => {
    const bin = new Uint8Array([0x4d, 0x5a, 0, 0, 0, 0, 0, 0]) // PE header w/ NULs
    await writeFile(join(dir, "exe"), bin)
    await writeFile(join(dir, "text.txt"), "match here")
    const r = await grep.execute({ pattern: "MZ" }, ctx())
    expect(r.matches.find((m) => m.file === "exe")).toBeUndefined()
  })

  test("skips node_modules", async () => {
    await mkdir(join(dir, "node_modules"), { recursive: true })
    await writeFile(join(dir, "node_modules", "x.ts"), "match")
    await writeFile(join(dir, "keep.ts"), "match")
    const r = await grep.execute({ pattern: "match" }, ctx())
    expect(r.matches.map((m) => m.file)).toEqual(["keep.ts"])
  })

  test("honors limit and reports truncated", async () => {
    let content = ""
    for (let i = 0; i < 50; i++) content += `match line ${i}\n`
    await writeFile(join(dir, "a.txt"), content)
    const r = await grep.execute({ pattern: "match", limit: 10 }, ctx())
    expect(r.count).toBe(10)
    expect(r.truncated).toBe(true)
  })

  test("invalid regex throws a useful error", async () => {
    await expect(grep.execute({ pattern: "(unclosed" }, ctx())).rejects.toThrow(/invalid regex/)
  })

  test("empty result when nothing matches", async () => {
    await writeFile(join(dir, "a.txt"), "nothing here")
    const r = await grep.execute({ pattern: "xyz" }, ctx())
    expect(r.count).toBe(0)
    expect(r.matches).toEqual([])
  })
})
