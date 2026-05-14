import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { multiEdit } from "../src/multi_edit.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omni-multi-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function ctx() {
  return { cwd: dir, signal: new AbortController().signal }
}

describe("multi_edit", () => {
  test("applies multiple edits in order", async () => {
    await writeFile(join(dir, "f.txt"), "alpha beta gamma\n")
    const r = await multiEdit.execute(
      {
        path: "f.txt",
        edits: [
          { old_string: "alpha", new_string: "ALPHA" },
          { old_string: "beta", new_string: "BETA" },
        ],
      },
      ctx(),
    )
    expect(r.editCount).toBe(2)
    expect(r.replacements).toBe(2)
    expect(await readFile(join(dir, "f.txt"), "utf8")).toBe("ALPHA BETA gamma\n")
  })

  test("later edits see earlier results", async () => {
    await writeFile(join(dir, "f.txt"), "foo")
    const r = await multiEdit.execute(
      {
        path: "f.txt",
        edits: [
          { old_string: "foo", new_string: "bar" },
          { old_string: "bar", new_string: "baz" },
        ],
      },
      ctx(),
    )
    expect(r.editCount).toBe(2)
    expect(await readFile(join(dir, "f.txt"), "utf8")).toBe("baz")
  })

  test("rolls back if any edit fails", async () => {
    const original = "one two three"
    await writeFile(join(dir, "f.txt"), original)
    await expect(
      multiEdit.execute(
        {
          path: "f.txt",
          edits: [
            { old_string: "one", new_string: "ONE" },
            { old_string: "nope", new_string: "X" },
          ],
        },
        ctx(),
      ),
    ).rejects.toThrow(/edit 2\/2.*not found/)
    expect(await readFile(join(dir, "f.txt"), "utf8")).toBe(original)
  })

  test("replace_all on a single edit applies globally", async () => {
    await writeFile(join(dir, "f.txt"), "x y x y x")
    const r = await multiEdit.execute(
      {
        path: "f.txt",
        edits: [{ old_string: "x", new_string: "X", replace_all: true }],
      },
      ctx(),
    )
    expect(r.replacements).toBe(3)
    expect(await readFile(join(dir, "f.txt"), "utf8")).toBe("X y X y X")
  })

  test("ambiguous edit without replace_all rolls back", async () => {
    const original = "x x"
    await writeFile(join(dir, "f.txt"), original)
    await expect(
      multiEdit.execute(
        {
          path: "f.txt",
          edits: [{ old_string: "x", new_string: "y" }],
        },
        ctx(),
      ),
    ).rejects.toThrow(/occurs 2 times/)
    expect(await readFile(join(dir, "f.txt"), "utf8")).toBe(original)
  })
})
