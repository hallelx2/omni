import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createTuiStore } from "../src/tui/state.ts"
import type { EngineEvent } from "@omni/core"

describe("tui store — subagent peek", () => {
  test("flags subagent tools and captures their progress trace", () => {
    createRoot((dispose) => {
      const store = createTuiStore({ modelName: "m", mcpServers: 0, mode: "build", agentNames: new Set(["explore"]) })
      store.pushEvent({ type: "tool.start", call: { id: "1", name: "explore", args: { task: "t" } } } as EngineEvent)
      store.pushEvent({ type: "tool.progress", call: { id: "1", name: "explore", args: {} }, message: "→ glob" } as EngineEvent)
      store.pushEvent({ type: "tool.progress", call: { id: "1", name: "explore", args: {} }, message: "→ grep" } as EngineEvent)
      store.pushEvent({ type: "tool.progress", call: { id: "1", name: "explore", args: {} }, message: "→ grep" } as EngineEvent) // dup
      const entry = store.messages().find((m) => m.kind === "tool")
      if (!entry || entry.kind !== "tool") throw new Error("expected a tool entry")
      expect(entry.subagent).toBe(true)
      expect(entry.progress).toEqual(["→ glob", "→ grep"]) // immediate dup collapsed
      dispose()
    })
  })

  test("dispatch_agents is treated as a subagent", () => {
    createRoot((dispose) => {
      const store = createTuiStore({ modelName: "m", mcpServers: 0, mode: "build", agentNames: new Set(["explore"]) })
      store.pushEvent({ type: "tool.start", call: { id: "2", name: "dispatch_agents", args: { tasks: [] } } } as EngineEvent)
      const entry = store.messages().find((m) => m.kind === "tool")
      expect(entry && entry.kind === "tool" && entry.subagent).toBe(true)
      dispose()
    })
  })

  test("ordinary tools are not flagged as subagents", () => {
    createRoot((dispose) => {
      const store = createTuiStore({ modelName: "m", mcpServers: 0, mode: "build", agentNames: new Set(["explore"]) })
      store.pushEvent({ type: "tool.start", call: { id: "3", name: "bash", args: { command: "ls" } } } as EngineEvent)
      const entry = store.messages().find((m) => m.kind === "tool")
      expect(entry && entry.kind === "tool" ? entry.subagent : true).toBeFalsy()
      dispose()
    })
  })
})
