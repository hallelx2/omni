import { describe, expect, test } from "bun:test"
import { clip } from "../src/util/clip.ts"

describe("clip", () => {
  test("returns untouched when within budget", () => {
    const r = clip("hello", 100)
    expect(r.truncated).toBe(false)
    expect(r.text).toBe("hello")
  })

  test("truncates with head/tail markers when oversized", () => {
    const s = "a".repeat(1000) + "b".repeat(1000)
    const r = clip(s, 1000)
    expect(r.truncated).toBe(true)
    expect(r.text.includes("truncated")).toBe(true)
    expect(r.text.includes("...")).toBe(true)
    // Total clipped text length should be approximately budget + small marker overhead.
    expect(r.text.length).toBeLessThan(1100)
  })

  test("preserves head and tail content from the original", () => {
    const head = "HEAD_MARKER_"
    const tail = "_TAIL_MARKER"
    const middle = "x".repeat(5000)
    const s = head + middle + tail
    const r = clip(s, 1000)
    expect(r.text.startsWith(head)).toBe(true)
    expect(r.text.endsWith(tail)).toBe(true)
    expect(r.text.includes(middle)).toBe(false)
  })

  test("zero-length input is unchanged", () => {
    const r = clip("", 100)
    expect(r.truncated).toBe(false)
    expect(r.text).toBe("")
  })

  test("byte budget exactly equal is not truncated", () => {
    const r = clip("abc", 3)
    expect(r.truncated).toBe(false)
    expect(r.text).toBe("abc")
  })
})
