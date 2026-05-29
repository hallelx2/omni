import { describe, expect, test } from "bun:test"
import {
  Storage,
  SessionsRepo,
  MessagesRepo,
  EventsRepo,
  ProfilesRepo,
  VariantsRepo,
  AuditRepo,
  SettingsRepo,
} from "../src/index.ts"

function mkStore() {
  return new Storage(":memory:")
}

describe("Storage migrations", () => {
  test("runs all migrations to head on first open", () => {
    const s = mkStore()
    expect(s.schemaVersion()).toBeGreaterThanOrEqual(3)
    s.close()
  })

  test("schema includes expected tables", () => {
    const s = mkStore()
    const tables = (
      s.db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string
      }>
    ).map((r) => r.name)
    for (const t of [
      "sessions",
      "messages",
      "events",
      "audit_log",
      "model_profiles",
      "prompt_variants",
      "settings",
    ]) {
      expect(tables).toContain(t)
    }
    s.close()
  })
})

describe("SessionsRepo", () => {
  test("create + get round-trip", () => {
    const s = mkStore()
    const repo = new SessionsRepo(s)
    repo.create("sess1", "mimo-v2.5-pro", { user: "test" })
    const r = repo.get("sess1")
    expect(r?.model_id).toBe("mimo-v2.5-pro")
    expect(r?.status).toBe("active")
    expect(r?.meta?.user).toBe("test")
    s.close()
  })

  test("setStatus + list filtering", () => {
    const s = mkStore()
    const repo = new SessionsRepo(s)
    repo.create("a", "m1")
    repo.create("b", "m1")
    repo.setStatus("a", "completed")
    const active = repo.list({ status: "active" })
    expect(active.map((r) => r.id)).toEqual(["b"])
    s.close()
  })

  test("delete cascades to messages via FK ON DELETE CASCADE", () => {
    const s = mkStore()
    const sessions = new SessionsRepo(s)
    const messages = new MessagesRepo(s)
    sessions.create("sess1", "m1")
    messages.append({
      id: "m1",
      session_id: "sess1",
      role: "user",
      content: "hi",
      timestamp: 1,
    })
    expect(messages.countBySession("sess1")).toBe(1)
    sessions.delete("sess1")
    expect(messages.countBySession("sess1")).toBe(0)
    s.close()
  })
})

describe("MessagesRepo", () => {
  test("append + bySession in timestamp order", () => {
    const s = mkStore()
    new SessionsRepo(s).create("sess1", "m1")
    const repo = new MessagesRepo(s)
    repo.append({ id: "1", session_id: "sess1", role: "user", content: "a", timestamp: 2 })
    repo.append({ id: "2", session_id: "sess1", role: "assistant", content: "b", timestamp: 1 })
    repo.append({ id: "3", session_id: "sess1", role: "assistant", content: "c", timestamp: 3 })
    const msgs = repo.bySession("sess1")
    expect(msgs.map((m) => m.id)).toEqual(["2", "1", "3"])
    s.close()
  })

  test("preserves tool_calls and metadata as JSON", () => {
    const s = mkStore()
    new SessionsRepo(s).create("sess1", "m1")
    const repo = new MessagesRepo(s)
    repo.append({
      id: "1",
      session_id: "sess1",
      role: "assistant",
      content: "",
      tool_calls: [{ id: "c1", name: "echo", args: { text: "hi" } }],
      metadata: { reasoningContent: "thought it through" },
      timestamp: 1,
    })
    const out = repo.bySession("sess1")[0]!
    expect(out.tool_calls).toEqual([{ id: "c1", name: "echo", args: { text: "hi" } }])
    expect(out.metadata?.reasoningContent).toBe("thought it through")
    s.close()
  })
})

describe("EventsRepo", () => {
  test("append + bySession + countByType", () => {
    const s = mkStore()
    new SessionsRepo(s).create("sess1", "m1")
    const repo = new EventsRepo(s)
    repo.append({ session_id: "sess1", t: 1, type: "engine.start", data: { x: 1 } })
    repo.append({ session_id: "sess1", t: 2, type: "engine.start", data: { x: 2 } })
    repo.append({ session_id: "sess1", t: 3, type: "engine.done", data: { ok: true } })
    expect(repo.bySession("sess1").length).toBe(3)
    expect(repo.countByType("sess1")["engine.start"]).toBe(2)
    expect(repo.countByType("sess1")["engine.done"]).toBe(1)
    s.close()
  })
})

describe("ProfilesRepo", () => {
  test("upsert and get", () => {
    const s = mkStore()
    const repo = new ProfilesRepo(s)
    repo.upsert("mimo-v2.5-pro", { nativeToolCalls: true, score: 0.9 })
    const r = repo.get<{ nativeToolCalls: boolean; score: number }>("mimo-v2.5-pro")
    expect(r?.profile.nativeToolCalls).toBe(true)
    expect(r?.profile.score).toBe(0.9)
    s.close()
  })

  test("upsert overwrites on conflict", () => {
    const s = mkStore()
    const repo = new ProfilesRepo(s)
    repo.upsert("m", { v: 1 })
    repo.upsert("m", { v: 2 })
    expect(repo.get<{ v: number }>("m")?.profile.v).toBe(2)
    s.close()
  })
})

describe("VariantsRepo", () => {
  test("recordTrial accumulates and ranked is fitness-sorted (per model)", () => {
    const s = mkStore()
    const repo = new VariantsRepo(s)
    repo.upsert({ id: "a", model_id: "m1", text: "alpha", trials: 0, success_score: 0, created_at: 1 })
    repo.upsert({ id: "b", model_id: "m1", text: "beta", trials: 0, success_score: 0, created_at: 2 })
    repo.recordTrial("a", 0.9)
    repo.recordTrial("a", 0.9)
    repo.recordTrial("b", 0.2)
    const r = repo.ranked("m1")
    expect(r[0]!.id).toBe("a")
    expect(r[1]!.id).toBe("b")
    expect(repo.get("a")?.trials).toBe(2)
    expect(repo.get("a")?.success_score).toBeCloseTo(1.8, 6)
    s.close()
  })

  test("pools are isolated per model", () => {
    const s = mkStore()
    const repo = new VariantsRepo(s)
    repo.upsert({ id: "a", model_id: "m1", text: "alpha", trials: 1, success_score: 0.5, created_at: 1 })
    repo.upsert({ id: "z", model_id: "m2", text: "zeta", trials: 1, success_score: 0.5, created_at: 1 })
    expect(repo.forModel("m1").map((v) => v.id)).toEqual(["a"])
    expect(repo.forModel("m2").map((v) => v.id)).toEqual(["z"])
    expect(repo.ranked("m1").length).toBe(1)
  })

  test("migration 5 added the model_id column", () => {
    const s = mkStore()
    expect(s.schemaVersion()).toBeGreaterThanOrEqual(5)
    const cols = (s.db.query("PRAGMA table_info(prompt_variants)").all() as Array<{ name: string }>).map(
      (c) => c.name,
    )
    expect(cols).toContain("model_id")
    s.close()
  })
})

describe("AuditRepo", () => {
  test("append + list by session", () => {
    const s = mkStore()
    const repo = new AuditRepo(s)
    repo.append({ session_id: "s1", tool: "bash", decision: "allow", args: { cmd: "ls" }, timestamp: 1 })
    repo.append({ session_id: "s1", tool: "bash", decision: "deny", args: { cmd: "rm /" }, timestamp: 2 })
    repo.append({ session_id: "s2", tool: "glob", decision: "allow", args: {}, timestamp: 3 })
    expect(repo.list({ sessionId: "s1" }).length).toBe(2)
    expect(repo.list().length).toBe(3)
    s.close()
  })
})

describe("SettingsRepo", () => {
  test("set + get + delete", () => {
    const s = mkStore()
    const repo = new SettingsRepo(s)
    repo.set("theme", "dark")
    repo.set("limits", { tokens: 200_000 })
    expect(repo.get<string>("theme")).toBe("dark")
    expect((repo.get<{ tokens: number }>("limits") ?? { tokens: 0 }).tokens).toBe(200_000)
    expect(repo.delete("theme")).toBe(true)
    expect(repo.get<string>("theme")).toBeNull()
    s.close()
  })

  test("all returns parsed object", () => {
    const s = mkStore()
    const repo = new SettingsRepo(s)
    repo.set("a", 1)
    repo.set("b", "two")
    const all = repo.all()
    expect(all["a"]).toBe(1)
    expect(all["b"]).toBe("two")
    s.close()
  })
})
