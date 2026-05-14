import { describe, expect, test } from "bun:test"
import { resolveUnderCwd } from "../src/util/path.ts"

describe("resolveUnderCwd", () => {
  test("resolves relative path against cwd", () => {
    const r = resolveUnderCwd("foo/bar.txt", "/work")
    expect(r.endsWith("foo/bar.txt") || r.endsWith("foo\\bar.txt")).toBe(true)
  })

  test("rejects paths escaping cwd", () => {
    expect(() => resolveUnderCwd("../escape.txt", "/work")).toThrow(/escapes/)
  })

  test("allows escape when opted in", () => {
    const r = resolveUnderCwd("../sibling/x", "/work/sub", { allowEscape: true })
    expect(typeof r).toBe("string")
  })

  test("empty path is rejected", () => {
    expect(() => resolveUnderCwd("", "/work")).toThrow(/empty/)
  })

  test("absolute path inside cwd is allowed", () => {
    const cwd = process.cwd()
    const r = resolveUnderCwd(`${cwd}/inner.txt`, cwd)
    expect(r).toContain("inner.txt")
  })

  test("absolute path outside cwd is rejected", () => {
    expect(() => resolveUnderCwd("/tmp/outside.txt", "/work")).toThrow(/escapes/)
  })
})
