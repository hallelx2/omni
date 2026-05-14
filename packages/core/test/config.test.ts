import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  loadConfig,
  saveConfig,
  resolveApiKey,
  resolveBaseURL,
  type Config,
} from "../src/index.ts"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "omni-config-"))
  delete process.env.MIMO_API_KEY
  delete process.env.MIMO_BASE_URL
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
  delete process.env.MIMO_API_KEY
  delete process.env.MIMO_BASE_URL
})

describe("loadConfig", () => {
  test("returns empty object when file missing", () => {
    const cfg = loadConfig(join(dir, "nope.json"))
    expect(cfg).toEqual({})
  })

  test("loads and validates a valid config", async () => {
    const path = join(dir, "config.json")
    await writeFile(
      path,
      JSON.stringify({
        adapter: "mimo",
        model: "mimo-v2.5-pro",
        providers: { mimo: { apiKey: "tp-x" } },
      }),
    )
    const cfg = loadConfig(path)
    expect(cfg.adapter).toBe("mimo")
    expect(cfg.providers?.mimo?.apiKey).toBe("tp-x")
  })

  test("throws on invalid JSON", async () => {
    const path = join(dir, "bad.json")
    await writeFile(path, "{ broken")
    expect(() => loadConfig(path)).toThrow(/not valid JSON/)
  })

  test("throws on schema violation", async () => {
    const path = join(dir, "wrong.json")
    await writeFile(path, JSON.stringify({ adapter: "fake" }))
    expect(() => loadConfig(path)).toThrow(/schema violation/)
  })
})

describe("saveConfig", () => {
  test("roundtrip with loadConfig", () => {
    const path = join(dir, "config.json")
    const cfg: Config = {
      adapter: "ollama",
      model: "qwen2.5-coder:7b",
      ui: { theme: "dark" },
    }
    saveConfig(cfg, path)
    const loaded = loadConfig(path)
    expect(loaded.adapter).toBe("ollama")
    expect(loaded.ui?.theme).toBe("dark")
  })

  test("creates parent directories", () => {
    const path = join(dir, "nested", "dirs", "config.json")
    saveConfig({ adapter: "mock" }, path)
    expect(loadConfig(path).adapter).toBe("mock")
  })

  test("rejects invalid input at save time", () => {
    const path = join(dir, "config.json")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => saveConfig({ adapter: "bogus" as any }, path)).toThrow()
  })
})

describe("resolveApiKey precedence", () => {
  test("explicit > env > config", () => {
    process.env.MIMO_API_KEY = "env-key"
    const cfg: Config = { providers: { mimo: { apiKey: "config-key" } } }
    expect(resolveApiKey("mimo", cfg, "explicit-key")).toBe("explicit-key")
    expect(resolveApiKey("mimo", cfg)).toBe("env-key")
    delete process.env.MIMO_API_KEY
    expect(resolveApiKey("mimo", cfg)).toBe("config-key")
  })

  test("returns undefined when nothing configured", () => {
    expect(resolveApiKey("mimo", {})).toBeUndefined()
  })
})

describe("resolveBaseURL precedence", () => {
  test("explicit > env > config", () => {
    process.env.MIMO_BASE_URL = "https://env.example/v1"
    const cfg: Config = { providers: { mimo: { baseURL: "https://config.example/v1" } } }
    expect(resolveBaseURL("mimo", cfg, "https://explicit.example/v1")).toBe(
      "https://explicit.example/v1",
    )
    expect(resolveBaseURL("mimo", cfg)).toBe("https://env.example/v1")
    delete process.env.MIMO_BASE_URL
    expect(resolveBaseURL("mimo", cfg)).toBe("https://config.example/v1")
  })

  test("ollama baseURL works (no apiKey field)", () => {
    process.env.OLLAMA_BASE_URL = "http://other:11434/v1"
    expect(resolveBaseURL("ollama", {})).toBe("http://other:11434/v1")
  })
})
