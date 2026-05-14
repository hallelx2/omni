import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { resolve, join } from "node:path"
import {
  omniHome,
  omniConfigPath,
  omniDbPath,
  omniTracesDir,
  omniMemoryPath,
  omniSettingsPath,
  omniPaths,
} from "../src/paths.ts"

const KEYS = ["OMNI_HOME", "OMNI_DB", "OMNI_TRACES", "OMNI_MEMORY", "OMNI_CONFIG"] as const

beforeEach(() => {
  for (const k of KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of KEYS) delete process.env[k]
})

describe("omni paths", () => {
  test("default home is ~/.omni", () => {
    expect(omniHome()).toBe(resolve(homedir(), ".omni"))
  })

  test("OMNI_HOME overrides the entire tree", () => {
    process.env.OMNI_HOME = "/tmp/custom-omni"
    expect(omniHome()).toBe(resolve("/tmp/custom-omni"))
    expect(omniDbPath()).toBe(resolve("/tmp/custom-omni", "db.sqlite"))
    expect(omniTracesDir()).toBe(resolve("/tmp/custom-omni", "traces"))
    expect(omniMemoryPath()).toBe(resolve("/tmp/custom-omni", "memory.json"))
  })

  test("per-path overrides take precedence over OMNI_HOME", () => {
    process.env.OMNI_HOME = "/tmp/custom"
    process.env.OMNI_DB = "/var/db.sqlite"
    expect(omniDbPath()).toBe(resolve("/var/db.sqlite"))
    // siblings still respect OMNI_HOME
    expect(omniTracesDir()).toBe(resolve("/tmp/custom", "traces"))
  })

  test("OMNI_CONFIG overrides config path", () => {
    process.env.OMNI_CONFIG = "/etc/omni.json"
    expect(omniConfigPath()).toBe(resolve("/etc/omni.json"))
  })

  test("omniPaths() snapshot contains all six paths", () => {
    const p = omniPaths()
    expect(p.home).toBe(omniHome())
    expect(p.config).toBe(omniConfigPath())
    expect(p.db).toBe(omniDbPath())
    expect(p.traces).toBe(omniTracesDir())
    expect(p.memory).toBe(omniMemoryPath())
    expect(p.settings).toBe(omniSettingsPath())
  })

  test("default db lives inside default home", () => {
    expect(omniDbPath().startsWith(omniHome())).toBe(true)
    expect(omniDbPath().endsWith("db.sqlite")).toBe(true)
  })
})
