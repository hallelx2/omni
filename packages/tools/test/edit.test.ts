import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { edit } from "../src/edit.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omni-edit-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function ctx() {
  return { cwd: dir, signal: new AbortController().signal }
}

describe("edit", () => {
  test("replaces a unique substring", async () => {
    await writeFile(join(dir, "f.txt"), "hello world\n")
    const r = await edit.execute(
      { path: "f.txt", old_string: "world", new_string: "omni" },
      ctx(),
    )
    expect(r.replacements).toBe(1)
    expect(await readFile(join(dir, "f.txt"), "utf8")).toBe("hello omni\n")
  })

  test("fails when old_string is not found", async () => {
    await writeFile(join(dir, "f.txt"), "hello\n")
    await expect(
      edit.execute({ path: "f.txt", old_string: "nope", new_string: "x" }, ctx()),
    ).rejects.toThrow(/not found/)
  })

  test("fails on multiple occurrences without replace_all", async () => {
    await writeFile(join(dir, "f.txt"), "x x x")
    await expect(
      edit.execute({ path: "f.txt", old_string: "x", new_string: "y" }, ctx()),
    ).rejects.toThrow(/occurs 3 times/)
  })

  test("replace_all replaces every occurrence", async () => {
    await writeFile(join(dir, "f.txt"), "x x x")
    const r = await edit.execute(
      { path: "f.txt", old_string: "x", new_string: "y", replace_all: true },
      ctx(),
    )
    expect(r.replacements).toBe(3)
    expect(await readFile(join(dir, "f.txt"), "utf8")).toBe("y y y")
  })

  test("preserves exact whitespace", async () => {
    const content = "line a\n\tindented\nline b\n"
    await writeFile(join(dir, "f.txt"), content)
    await edit.execute(
      { path: "f.txt", old_string: "\tindented", new_string: "\t\tdeeper" },
      ctx(),
    )
    expect(await readFile(join(dir, "f.txt"), "utf8")).toBe("line a\n\t\tdeeper\nline b\n")
  })

  test("returns a diff summary", async () => {
    await writeFile(join(dir, "f.txt"), "alpha\nbeta\ngamma\n")
    const r = await edit.execute(
      { path: "f.txt", old_string: "beta", new_string: "BETA" },
      ctx(),
    )
    expect(r.diff).toContain("- beta")
    expect(r.diff).toContain("+ BETA")
  })

  test("rejects paths escaping cwd", async () => {
    await writeFile(join(dir, "f.txt"), "x")
    await expect(
      edit.execute({ path: "../../etc/passwd", old_string: "x", new_string: "y" }, ctx()),
    ).rejects.toThrow(/escapes/)
  })

  test("fails on missing file", async () => {
    await expect(
      edit.execute({ path: "nope.txt", old_string: "x", new_string: "y" }, ctx()),
    ).rejects.toThrow(/file not found/)
  })
})
