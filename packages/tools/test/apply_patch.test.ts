import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { applyPatch, parseUnifiedDiff } from "../src/apply_patch.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omni-patch-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function ctx() {
  return { cwd: dir, signal: new AbortController().signal }
}

describe("parseUnifiedDiff", () => {
  test("parses a basic single-file patch", () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 alpha
-beta
+BETA
 gamma`
    const p = parseUnifiedDiff(diff)
    expect(p).toHaveLength(1)
    expect(p[0]!.oldPath).toBe("file.ts")
    expect(p[0]!.newPath).toBe("file.ts")
    expect(p[0]!.hunks).toHaveLength(1)
    expect(p[0]!.hunks[0]!.oldStart).toBe(1)
  })

  test("strips git a/ b/ prefixes", () => {
    const p = parseUnifiedDiff(`--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new`)
    expect(p[0]!.oldPath).toBe("src/foo.ts")
    expect(p[0]!.newPath).toBe("src/foo.ts")
  })

  test("handles multi-file patch", () => {
    const diff = `--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-x
+X
--- a/b.ts
+++ b/b.ts
@@ -1 +1 @@
-y
+Y`
    const p = parseUnifiedDiff(diff)
    expect(p).toHaveLength(2)
    expect(p.map((x) => x.newPath)).toEqual(["a.ts", "b.ts"])
  })

  test("strips markdown ```diff fence", () => {
    const diff = "```diff\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+new\n```"
    const p = parseUnifiedDiff(diff)
    expect(p).toHaveLength(1)
  })

  test("recognises /dev/null as create or delete", () => {
    const create = parseUnifiedDiff(`--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,2 @@\n+line one\n+line two`)
    expect(create[0]!.oldPath).toBe("/dev/null")
    const del = parseUnifiedDiff(`--- a/gone.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-line one\n-line two`)
    expect(del[0]!.newPath).toBe("/dev/null")
  })

  test("ignores 'No newline at end of file' marker", () => {
    const diff = `--- a/f.ts\n+++ b/f.ts\n@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file`
    const p = parseUnifiedDiff(diff)
    expect(p[0]!.hunks).toHaveLength(1)
  })

  test("returns empty when input has no patches", () => {
    expect(parseUnifiedDiff("plain text, no diff")).toEqual([])
  })
})

describe("applyPatch — modify", () => {
  test("applies a basic in-place edit", async () => {
    await writeFile(join(dir, "f.txt"), "alpha\nbeta\ngamma\n")
    const diff = `--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,3 @@
 alpha
-beta
+BETA
 gamma`
    const r = await applyPatch.execute({ patch: diff }, ctx())
    expect(r.applied).toHaveLength(1)
    expect(r.applied[0]!.action).toBe("modified")
    expect(await readFile(join(dir, "f.txt"), "utf8")).toBe("alpha\nBETA\ngamma\n")
  })

  test("multi-hunk patch in a single file", async () => {
    await writeFile(join(dir, "f.txt"), "a\nb\nc\nd\ne\nf\ng\n")
    const diff = `--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,3 @@
 a
-b
+B
 c
@@ -5,3 +5,3 @@
 e
-f
+F
 g`
    await applyPatch.execute({ patch: diff }, ctx())
    expect(await readFile(join(dir, "f.txt"), "utf8")).toBe("a\nB\nc\nd\ne\nF\ng\n")
  })

  test("fuzzy whitespace match locates a drifted hunk", async () => {
    // Source has different whitespace from what the patch context says
    await writeFile(join(dir, "f.txt"), "  alpha\nbeta\n  gamma\n")
    const diff = `--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,3 @@
 alpha
-beta
+BETA
 gamma`
    await applyPatch.execute({ patch: diff }, ctx())
    const out = await readFile(join(dir, "f.txt"), "utf8")
    expect(out).toContain("BETA")
  })

  test("dry_run does not modify the file", async () => {
    const original = "alpha\nbeta\ngamma\n"
    await writeFile(join(dir, "f.txt"), original)
    const diff = `--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n alpha\n-beta\n+BETA\n gamma`
    const r = await applyPatch.execute({ patch: diff, dry_run: true }, ctx())
    expect(r.applied).toHaveLength(1)
    expect(await readFile(join(dir, "f.txt"), "utf8")).toBe(original)
  })

  test("returns diff summary per file", async () => {
    await writeFile(join(dir, "f.txt"), "alpha\nbeta\ngamma\n")
    const diff = `--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n alpha\n-beta\n+BETA\n gamma`
    const r = await applyPatch.execute({ patch: diff }, ctx())
    expect(r.applied[0]!.diff).toContain("- beta")
    expect(r.applied[0]!.diff).toContain("+ BETA")
  })
})

describe("applyPatch — create", () => {
  test("creates a new file from /dev/null", async () => {
    const diff = `--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+line one
+line two`
    const r = await applyPatch.execute({ patch: diff }, ctx())
    expect(r.applied[0]!.action).toBe("created")
    expect(await readFile(join(dir, "new.ts"), "utf8")).toBe("line one\nline two")
  })

  test("create-targets-existing-file fails (all-failure case throws)", async () => {
    await writeFile(join(dir, "exists.ts"), "x")
    const diff = `--- /dev/null\n+++ b/exists.ts\n@@ -0,0 +1 @@\n+y`
    await expect(applyPatch.execute({ patch: diff }, ctx())).rejects.toThrow(/existing/)
  })
})

describe("applyPatch — delete", () => {
  test("deletes a file targeted by /dev/null", async () => {
    await writeFile(join(dir, "gone.ts"), "x\ny\n")
    const diff = `--- a/gone.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-x\n-y`
    const r = await applyPatch.execute({ patch: diff }, ctx())
    expect(r.applied[0]!.action).toBe("deleted")
    const file = Bun.file(join(dir, "gone.ts"))
    expect(await file.exists()).toBe(false)
  })
})

describe("applyPatch — multi-file", () => {
  test("applies edits to multiple files in one call", async () => {
    await writeFile(join(dir, "a.txt"), "1\n2\n3\n")
    await writeFile(join(dir, "b.txt"), "x\ny\nz\n")
    const diff = `--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,3 @@
 1
-2
+TWO
 3
--- a/b.txt
+++ b/b.txt
@@ -1,3 +1,3 @@
 x
-y
+Y
 z`
    const r = await applyPatch.execute({ patch: diff }, ctx())
    expect(r.applied).toHaveLength(2)
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("1\nTWO\n3\n")
    expect(await readFile(join(dir, "b.txt"), "utf8")).toBe("x\nY\nz\n")
  })
})

describe("applyPatch — errors", () => {
  test("missing file is reported in `failed`, not thrown if other patches succeed", async () => {
    await writeFile(join(dir, "real.txt"), "a\n")
    const diff = `--- a/real.txt
+++ b/real.txt
@@ -1 +1 @@
-a
+A
--- a/missing.txt
+++ b/missing.txt
@@ -1 +1 @@
-x
+X`
    const r = await applyPatch.execute({ patch: diff }, ctx())
    expect(r.applied).toHaveLength(1)
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0]!.reason).toContain("not found")
  })

  test("all-failures throws so the model can correct", async () => {
    const diff = `--- a/nope.txt\n+++ b/nope.txt\n@@ -1 +1 @@\n-a\n+A`
    await expect(applyPatch.execute({ patch: diff }, ctx())).rejects.toThrow(/all 1 file/)
  })

  test("unfindable hunk throws with a useful reason", async () => {
    await writeFile(join(dir, "f.txt"), "completely\ndifferent\ncontent\n")
    const diff = `--- a/f.txt
+++ b/f.txt
@@ -1,3 +1,3 @@
 alpha
-beta
+BETA
 gamma`
    await expect(applyPatch.execute({ patch: diff }, ctx())).rejects.toThrow(/could not be located/)
  })
})
