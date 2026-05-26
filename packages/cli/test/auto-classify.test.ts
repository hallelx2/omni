import { describe, expect, test } from "bun:test"
import { MockAdapter } from "../../adapters/src/mock.ts"
import { classifyIntent } from "../src/auto-classify.ts"

const reply = (text: string) => new MockAdapter({ script: [{ kind: "text", text }] })

describe("classifyIntent", () => {
  test("parses 'plan'", async () => {
    expect(await classifyIntent("what should we do about X?", reply("plan"))).toBe("plan")
  })
  test("parses 'auto'", async () => {
    expect(await classifyIntent("fix the typo in README", reply("auto"))).toBe("auto")
  })
  test("parses 'build'", async () => {
    expect(await classifyIntent("refactor the auth module", reply("build"))).toBe("build")
  })
  test("returns null on an unclear reply", async () => {
    expect(await classifyIntent("hello", reply("I'm not sure"))).toBeNull()
  })
  test("returns null on empty input (no model call needed)", async () => {
    expect(await classifyIntent("   ", reply("plan"))).toBeNull()
  })
  test("case-insensitive and tolerant of trailing punctuation/newlines", async () => {
    expect(await classifyIntent("x", reply("Plan."))).toBe("plan")
    expect(await classifyIntent("x", reply("AUTO\n"))).toBe("auto")
    expect(await classifyIntent("x", reply("  build  "))).toBe("build")
  })
})
