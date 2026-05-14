import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadDotenv } from "../src/env.ts"

let dir: string
const savedKeys = ["OMNI_TEST_ALPHA", "OMNI_TEST_BETA"]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omni-env-"))
  for (const k of savedKeys) delete process.env[k]
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  for (const k of savedKeys) delete process.env[k]
})

describe("loadDotenv", () => {
  test("loads keys from a .env file", async () => {
    const p = join(dir, ".env")
    await writeFile(p, "OMNI_TEST_ALPHA=value-a\nOMNI_TEST_BETA=value-b\n")
    loadDotenv([p])
    expect(process.env.OMNI_TEST_ALPHA).toBe("value-a")
    expect(process.env.OMNI_TEST_BETA).toBe("value-b")
  })

  test("overrides pre-set shell values", async () => {
    process.env.OMNI_TEST_ALPHA = "shell-value"
    const p = join(dir, ".env")
    await writeFile(p, "OMNI_TEST_ALPHA=env-file-wins\n")
    loadDotenv([p])
    expect(process.env.OMNI_TEST_ALPHA).toBe("env-file-wins")
  })

  test("strips surrounding quotes", async () => {
    const p = join(dir, ".env")
    await writeFile(p, `OMNI_TEST_ALPHA="quoted"\nOMNI_TEST_BETA='single'\n`)
    loadDotenv([p])
    expect(process.env.OMNI_TEST_ALPHA).toBe("quoted")
    expect(process.env.OMNI_TEST_BETA).toBe("single")
  })

  test("ignores comments and blank lines", async () => {
    const p = join(dir, ".env")
    await writeFile(p, "# a comment\n\nOMNI_TEST_ALPHA=keep\n# OMNI_TEST_BETA=ignored\n")
    loadDotenv([p])
    expect(process.env.OMNI_TEST_ALPHA).toBe("keep")
    expect(process.env.OMNI_TEST_BETA).toBeUndefined()
  })

  test("first candidate found wins", async () => {
    const p1 = join(dir, "first")
    const p2 = join(dir, "second")
    await writeFile(p1, "OMNI_TEST_ALPHA=from-first\n")
    await writeFile(p2, "OMNI_TEST_ALPHA=from-second\n")
    loadDotenv([p1, p2])
    expect(process.env.OMNI_TEST_ALPHA).toBe("from-first")
  })

  test("missing files are silently skipped", () => {
    expect(() => loadDotenv(["/nonexistent/.env"])).not.toThrow()
  })
})
