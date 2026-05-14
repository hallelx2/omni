import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Memory } from "../src/memory.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omni-mem-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("Memory", () => {
  test("add returns entry with id and timestamp", async () => {
    const m = new Memory({ path: join(dir, "m.json") })
    const e = await m.add({ kind: "fact", text: "the sky is blue" })
    expect(e.id).toBeTruthy()
    expect(e.createdAt).toBeGreaterThan(0)
    expect(e.kind).toBe("fact")
  })

  test("persists across instances", async () => {
    const path = join(dir, "m.json")
    const m1 = new Memory({ path })
    await m1.add({ kind: "fact", text: "user likes typescript" })
    const m2 = new Memory({ path })
    const all = await m2.all()
    expect(all.length).toBe(1)
    expect(all[0]!.text).toBe("user likes typescript")
  })

  test("recall finds by keyword overlap", async () => {
    const m = new Memory({ path: join(dir, "m.json") })
    await m.add({ kind: "fact", text: "use typescript strict mode" })
    await m.add({ kind: "fact", text: "prefer pnpm for installs" })
    await m.add({ kind: "fact", text: "always commit with conventional messages" })
    const r = await m.recall("typescript")
    expect(r.length).toBeGreaterThan(0)
    expect(r[0]!.text).toContain("typescript")
  })

  test("recall filters by kind", async () => {
    const m = new Memory({ path: join(dir, "m.json") })
    await m.add({ kind: "fact", text: "javascript is loose" })
    await m.add({ kind: "preference", text: "javascript not preferred" })
    const r = await m.recall("javascript", { kind: "preference" })
    expect(r.every((e) => e.kind === "preference")).toBe(true)
  })

  test("recall filters by tag even with empty query", async () => {
    const m = new Memory({ path: join(dir, "m.json") })
    await m.add({ kind: "fact", text: "a", tags: ["x"] })
    await m.add({ kind: "fact", text: "b", tags: ["y"] })
    const r = await m.recall("", { tag: "x", limit: 100 })
    expect(r.length).toBe(1)
    expect(r[0]!.tags).toContain("x")
  })

  test("remove deletes by id", async () => {
    const m = new Memory({ path: join(dir, "m.json") })
    const e = await m.add({ kind: "fact", text: "ephemeral" })
    expect(await m.remove(e.id)).toBe(true)
    expect((await m.all()).length).toBe(0)
    expect(await m.remove(e.id)).toBe(false) // already gone
  })

  test("clear empties the store", async () => {
    const m = new Memory({ path: join(dir, "m.json") })
    await m.add({ kind: "fact", text: "x" })
    await m.add({ kind: "fact", text: "y" })
    await m.clear()
    expect((await m.all()).length).toBe(0)
  })

  test("works in-memory when path not provided", async () => {
    const m = new Memory()
    await m.add({ kind: "fact", text: "transient" })
    expect((await m.all()).length).toBe(1)
  })

  test("recovers from corrupt file by backing it up", async () => {
    const path = join(dir, "bad.json")
    await Bun.write(path, "{ not json")
    const m = new Memory({ path })
    await m.load()
    expect((await m.all()).length).toBe(0)
    const bakExists = await Bun.file(`${path}.bak`).exists()
    expect(bakExists).toBe(true)
  })
})
