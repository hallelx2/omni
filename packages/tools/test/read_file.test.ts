import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { readFile } from "../src/fs.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omni-read-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function ctx() {
  return { cwd: dir, signal: new AbortController().signal }
}

describe("read_file", () => {
  test("returns whole file as string when no slice requested", async () => {
    await writeFile(join(dir, "a.txt"), "hello\nworld\n")
    const r = await readFile.execute({ path: "a.txt" }, ctx())
    expect(r).toBe("hello\nworld\n")
  })

  test("returns a slice when start_line + end_line passed", async () => {
    await writeFile(join(dir, "a.txt"), "a\nb\nc\nd\ne")
    const r = await readFile.execute({ path: "a.txt", start_line: 2, end_line: 4 }, ctx())
    if (typeof r === "string") throw new Error("expected ReadResult")
    expect(r.content).toBe("b\nc\nd")
    expect(r.totalLines).toBe(5)
    expect(r.startLine).toBe(2)
    expect(r.endLine).toBe(4)
    expect(r.truncated).toBe(true)
  })

  test("end_line beyond file is clamped", async () => {
    await writeFile(join(dir, "a.txt"), "a\nb\nc")
    const r = await readFile.execute({ path: "a.txt", start_line: 1, end_line: 999 }, ctx())
    if (typeof r === "string") throw new Error("expected ReadResult")
    expect(r.content).toBe("a\nb\nc")
    expect(r.endLine).toBe(3)
    expect(r.truncated).toBe(false)
  })

  test("start_line past EOF returns empty", async () => {
    await writeFile(join(dir, "a.txt"), "only line")
    const r = await readFile.execute({ path: "a.txt", start_line: 50 }, ctx())
    if (typeof r === "string") throw new Error("expected ReadResult")
    expect(r.content).toBe("")
  })

  test("fails on missing file", async () => {
    await expect(readFile.execute({ path: "nope" }, ctx())).rejects.toThrow(/not found/)
  })
})
