import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile, utimes } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { glob } from "../src/glob.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omni-glob-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function ctx() {
  return { cwd: dir, signal: new AbortController().signal }
}

describe("glob", () => {
  test("matches files by pattern", async () => {
    await writeFile(join(dir, "a.ts"), "")
    await writeFile(join(dir, "b.js"), "")
    await writeFile(join(dir, "c.ts"), "")
    const r = await glob.execute({ pattern: "*.ts" }, ctx())
    expect(r.paths.sort()).toEqual(["a.ts", "c.ts"])
    expect(r.count).toBe(2)
    expect(r.truncated).toBe(false)
  })

  test("matches nested files with **", async () => {
    await mkdir(join(dir, "sub", "deep"), { recursive: true })
    await writeFile(join(dir, "sub", "x.ts"), "")
    await writeFile(join(dir, "sub", "deep", "y.ts"), "")
    const r = await glob.execute({ pattern: "**/*.ts" }, ctx())
    expect(r.count).toBe(2)
  })

  test("skips node_modules and .git", async () => {
    await mkdir(join(dir, "node_modules", "x"), { recursive: true })
    await mkdir(join(dir, ".git"), { recursive: true })
    await writeFile(join(dir, "node_modules", "x", "skip.ts"), "")
    await writeFile(join(dir, ".git", "config.ts"), "")
    await writeFile(join(dir, "keep.ts"), "")
    const r = await glob.execute({ pattern: "**/*.ts" }, ctx())
    expect(r.paths).toEqual(["keep.ts"])
  })

  test("sorts by modification time, most recent first", async () => {
    await writeFile(join(dir, "old.ts"), "")
    await writeFile(join(dir, "new.ts"), "")
    const now = new Date()
    const earlier = new Date(now.getTime() - 60_000)
    await utimes(join(dir, "old.ts"), earlier, earlier)
    await utimes(join(dir, "new.ts"), now, now)
    const r = await glob.execute({ pattern: "*.ts" }, ctx())
    expect(r.paths[0]).toBe("new.ts")
    expect(r.paths[1]).toBe("old.ts")
  })

  test("honors limit", async () => {
    for (let i = 0; i < 10; i++) await writeFile(join(dir, `${i}.ts`), "")
    const r = await glob.execute({ pattern: "*.ts", limit: 3 }, ctx())
    expect(r.paths.length).toBe(3)
    expect(r.truncated).toBe(true)
  })

  test("empty result when no matches", async () => {
    const r = await glob.execute({ pattern: "*.xyz" }, ctx())
    expect(r.paths).toEqual([])
    expect(r.count).toBe(0)
  })
})
