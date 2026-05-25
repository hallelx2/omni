import { describe, expect, test } from "bun:test"
import { createModeHolder, PLAN_MODE_TOOLS } from "../src/mode.ts"

describe("createModeHolder", () => {
  test("get / set / source / subscribe / unsubscribe", () => {
    const h = createModeHolder("build")
    expect(h.get()).toBe("build")
    expect(h.source()).toBe("default")

    const seen: string[] = []
    const unsub = h.subscribe((m) => seen.push(m))
    h.set("plan", "manual")
    expect(h.get()).toBe("plan")
    expect(h.source()).toBe("manual")
    expect(seen).toEqual(["plan"])

    unsub()
    h.set("build")
    expect(seen).toEqual(["plan"]) // no notification after unsubscribe
  })

  test("setting the same mode is a no-op (no notification)", () => {
    const h = createModeHolder("build")
    const seen: string[] = []
    h.subscribe((m) => seen.push(m))
    h.set("build")
    expect(seen).toEqual([])
  })
})

describe("PLAN_MODE_TOOLS", () => {
  test("contains read-only tools + the escape hatch, excludes mutating tools", () => {
    for (const t of ["read_file", "glob", "grep", "web_fetch", "request_build_mode"]) {
      expect(PLAN_MODE_TOOLS.has(t)).toBe(true)
    }
    for (const t of ["bash", "write_file", "edit", "multi_edit", "apply_patch"]) {
      expect(PLAN_MODE_TOOLS.has(t)).toBe(false)
    }
  })
})
