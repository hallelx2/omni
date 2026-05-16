import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  PatchAppliesVerifier,
  FileParsesVerifier,
  TypecheckVerifier,
  TestVerifier,
} from "../src/verifiers/index.ts"
import type { VerifyContext } from "@omni/core"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omni-verifier-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function ctx(call: { name: string; args: unknown }, result: unknown): VerifyContext {
  return {
    call: { id: "c1", ...call },
    result,
    cwd: dir,
    signal: new AbortController().signal,
  }
}

// ─── PatchAppliesVerifier ──────────────────────────────────────────────────

describe("PatchAppliesVerifier", () => {
  const v = new PatchAppliesVerifier()

  test("pass when applied is non-empty and failed is empty", async () => {
    const r = await v.verify(
      ctx(
        { name: "apply_patch", args: {} },
        { applied: [{ path: "x.ts", hunks: 1, added: 1, removed: 0, action: "modified", diff: "" }], failed: [] },
      ),
    )
    expect(r.status).toBe("pass")
  })

  test("fail when failed has entries", async () => {
    const r = await v.verify(
      ctx(
        { name: "apply_patch", args: {} },
        { applied: [], failed: [{ path: "y.ts", reason: "hunk @@ -1,3 could not be located" }] },
      ),
    )
    expect(r.status).toBe("fail")
    expect(r.feedback).toContain("y.ts")
    expect(r.feedback).toContain("could not be located")
  })

  test("fail when applied is empty (no patches landed)", async () => {
    const r = await v.verify(
      ctx({ name: "apply_patch", args: {} }, { applied: [], failed: [] }),
    )
    expect(r.status).toBe("fail")
  })

  test("skip when result shape is wrong", async () => {
    const r = await v.verify(ctx({ name: "apply_patch", args: {} }, "not an object"))
    expect(r.status).toBe("skip")
  })
})

// ─── FileParsesVerifier ────────────────────────────────────────────────────

describe("FileParsesVerifier", () => {
  const v = new FileParsesVerifier()

  test("pass on syntactically valid TypeScript", async () => {
    await writeFile(join(dir, "ok.ts"), "export const x: number = 1\n")
    const r = await v.verify(
      ctx({ name: "edit", args: { path: "ok.ts" } }, { ok: true }),
    )
    expect(r.status).toBe("pass")
  })

  test("fail on syntactically broken TypeScript", async () => {
    await writeFile(join(dir, "bad.ts"), "export const x = (1 + \n") // unclosed expr
    const r = await v.verify(
      ctx({ name: "edit", args: { path: "bad.ts" } }, { ok: true }),
    )
    expect(r.status).toBe("fail")
    expect(r.feedback).toContain("bad.ts")
  })

  test("pass on valid JSON", async () => {
    await writeFile(join(dir, "ok.json"), '{"a": 1}\n')
    const r = await v.verify(
      ctx({ name: "write", args: { path: "ok.json" } }, { ok: true }),
    )
    expect(r.status).toBe("pass")
  })

  test("fail on broken JSON", async () => {
    await writeFile(join(dir, "bad.json"), '{"a": 1,}')
    const r = await v.verify(
      ctx({ name: "write", args: { path: "bad.json" } }, { ok: true }),
    )
    expect(r.status).toBe("fail")
  })

  test("skip on non-parseable extension", async () => {
    await writeFile(join(dir, "f.md"), "# hello")
    const r = await v.verify(
      ctx({ name: "edit", args: { path: "f.md" } }, { ok: true }),
    )
    expect(r.status).toBe("skip")
  })

  test("apply_patch: reads paths from result.applied (skips deletions)", async () => {
    await writeFile(join(dir, "a.ts"), "export const a = 1\n")
    await writeFile(join(dir, "b.ts"), "export const b = (\n") // broken
    const r = await v.verify(
      ctx(
        { name: "apply_patch", args: {} },
        {
          applied: [
            { path: "a.ts", hunks: 1, added: 1, removed: 0, action: "modified", diff: "" },
            { path: "b.ts", hunks: 1, added: 1, removed: 0, action: "modified", diff: "" },
            { path: "gone.ts", hunks: 0, added: 0, removed: 1, action: "deleted", diff: "" },
          ],
          failed: [],
        },
      ),
    )
    expect(r.status).toBe("fail")
    expect(r.feedback).toContain("b.ts")
    // Deleted files shouldn't fail the verifier — they're not on disk to parse
    expect(r.feedback).not.toContain("gone.ts")
  })

  test("skip when args has no path", async () => {
    const r = await v.verify(ctx({ name: "edit", args: {} }, { ok: true }))
    expect(r.status).toBe("skip")
  })
})

// ─── Shell verifiers (Typecheck / Test) ────────────────────────────────────

describe("TypecheckVerifier", () => {
  test("pass when command exits 0", async () => {
    const v = new TypecheckVerifier({ command: process.platform === "win32" ? "exit 0" : "true" })
    const r = await v.verify(ctx({ name: "edit", args: { path: "x.ts" } }, {}))
    expect(r.status).toBe("pass")
  })

  test("fail when command exits non-zero, feedback contains output", async () => {
    const v = new TypecheckVerifier({
      command:
        process.platform === "win32"
          ? "Write-Output 'TS2304: cannot find foo'; exit 1"
          : "echo 'TS2304: cannot find foo'; exit 1",
    })
    const r = await v.verify(ctx({ name: "edit", args: { path: "x.ts" } }, {}))
    expect(r.status).toBe("fail")
    expect(r.feedback).toContain("TS2304")
    expect(r.feedback).toContain("Fix the type errors")
  })

  test("skip on timeout", async () => {
    const v = new TypecheckVerifier({
      command: process.platform === "win32" ? "Start-Sleep -Seconds 10" : "sleep 10",
      timeoutMs: 300,
    })
    const r = await v.verify(ctx({ name: "edit", args: { path: "x.ts" } }, {}))
    expect(r.status).toBe("skip")
    expect(r.reason).toContain("timeout")
  })
})

describe("TestVerifier", () => {
  test("uses configured command", async () => {
    const v = new TestVerifier({ command: process.platform === "win32" ? "exit 0" : "true" })
    const r = await v.verify(ctx({ name: "edit", args: { path: "x.ts" } }, {}))
    expect(r.status).toBe("pass")
  })

  test("fail surfaces output as feedback", async () => {
    const v = new TestVerifier({
      command:
        process.platform === "win32"
          ? "Write-Output 'FAIL: my-test'; exit 1"
          : "echo 'FAIL: my-test'; exit 1",
    })
    const r = await v.verify(ctx({ name: "write", args: { path: "x.ts" } }, {}))
    expect(r.status).toBe("fail")
    expect(r.feedback).toContain("FAIL: my-test")
    expect(r.feedback).toContain("Read the failing test output")
  })
})
