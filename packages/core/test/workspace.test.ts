import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  workspaceOmniDir,
  workspacePaths,
  loadMergedConfig,
  mergeConfigs,
  expandEnv,
  expandEnvDeep,
  type Config,
} from "../src/index.ts"

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "omni-ws-"))
  delete process.env.OMNI_HOME
  delete process.env.OMNI_CONFIG
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  delete process.env.OMNI_HOME
  delete process.env.OMNI_CONFIG
})

describe("workspaceOmniDir", () => {
  test("returns null when no .omni/ found", () => {
    expect(workspaceOmniDir(root)).toBeNull()
  })

  test("finds .omni/ in cwd", async () => {
    await mkdir(join(root, ".omni"), { recursive: true })
    expect(workspaceOmniDir(root)).toBe(join(root, ".omni"))
  })

  test("walks upward to find .omni/", async () => {
    await mkdir(join(root, ".omni"), { recursive: true })
    await mkdir(join(root, "a", "b", "c"), { recursive: true })
    expect(workspaceOmniDir(join(root, "a", "b", "c"))).toBe(join(root, ".omni"))
  })

  test("workspacePaths returns null when none", () => {
    expect(workspacePaths(root)).toBeNull()
  })

  test("workspacePaths returns all subpaths when found", async () => {
    await mkdir(join(root, ".omni"), { recursive: true })
    const wp = workspacePaths(root)
    expect(wp).not.toBeNull()
    expect(wp!.config).toBe(join(root, ".omni", "config.json"))
    expect(wp!.commands).toBe(join(root, ".omni", "commands"))
    expect(wp!.skills).toBe(join(root, ".omni", "skills"))
    expect(wp!.hooks).toBe(join(root, ".omni", "hooks"))
  })
})

describe("mergeConfigs", () => {
  test("scalar override", () => {
    const base: Config = { adapter: "mock", model: "x" }
    const over: Config = { model: "y" }
    expect(mergeConfigs(base, over)).toEqual({ adapter: "mock", model: "y" })
  })

  test("nested record merge", () => {
    const base: Config = { providers: { mimo: { apiKey: "user-key" } } }
    const over: Config = { providers: { mimo: { baseURL: "https://ws.example/v1" } } }
    const out = mergeConfigs(base, over)
    expect(out.providers?.mimo?.apiKey).toBe("user-key")
    expect(out.providers?.mimo?.baseURL).toBe("https://ws.example/v1")
  })

  test("array concatenation for hooks", () => {
    const base: Config = {
      hooks: [{ event: "preToolUse", command: "user-hook.sh" }],
    }
    const over: Config = {
      hooks: [{ event: "postToolUse", command: "ws-hook.sh" }],
    }
    const out = mergeConfigs(base, over)
    expect(out.hooks).toHaveLength(2)
    expect(out.hooks?.[0]?.command).toBe("user-hook.sh")
    expect(out.hooks?.[1]?.command).toBe("ws-hook.sh")
  })

  test("workspace MCP server overrides user MCP server with same key", () => {
    const base: Config = {
      mcp: { servers: { fs: { kind: "stdio", command: "user-fs" } } },
    }
    const over: Config = {
      mcp: { servers: { fs: { kind: "stdio", command: "ws-fs" } } },
    }
    const out = mergeConfigs(base, over)
    expect(out.mcp?.servers?.fs?.command).toBe("ws-fs")
  })
})

describe("loadMergedConfig", () => {
  test("returns user config when no workspace", async () => {
    process.env.OMNI_HOME = root
    await mkdir(root, { recursive: true })
    await writeFile(
      join(root, "config.json"),
      JSON.stringify({ adapter: "mock", model: "user-model" }),
    )
    const merged = loadMergedConfig(root)
    expect(merged.adapter).toBe("mock")
    expect(merged.model).toBe("user-model")
  })

  test("workspace overrides user", async () => {
    process.env.OMNI_HOME = join(root, "home")
    await mkdir(join(root, "home"), { recursive: true })
    await writeFile(
      join(root, "home", "config.json"),
      JSON.stringify({ adapter: "mock", model: "user-model" }),
    )
    const ws = join(root, "project")
    await mkdir(join(ws, ".omni"), { recursive: true })
    await writeFile(
      join(ws, ".omni", "config.json"),
      JSON.stringify({ model: "ws-model" }),
    )
    const merged = loadMergedConfig(ws)
    expect(merged.adapter).toBe("mock") // from user
    expect(merged.model).toBe("ws-model") // workspace wins
  })
})

describe("expandEnv", () => {
  test("substitutes single var", () => {
    process.env.OMNI_TEST_FOO = "hello"
    expect(expandEnv("prefix ${OMNI_TEST_FOO} suffix")).toBe("prefix hello suffix")
    delete process.env.OMNI_TEST_FOO
  })

  test("multiple vars", () => {
    process.env.OMNI_TEST_A = "1"
    process.env.OMNI_TEST_B = "2"
    expect(expandEnv("${OMNI_TEST_A}-${OMNI_TEST_B}")).toBe("1-2")
    delete process.env.OMNI_TEST_A
    delete process.env.OMNI_TEST_B
  })

  test("missing var → empty string", () => {
    expect(expandEnv("a ${OMNI_TEST_MISSING} b")).toBe("a  b")
  })

  test("expandEnvDeep walks objects + arrays", () => {
    process.env.OMNI_TEST_KEY = "secret"
    const input = {
      a: "literal",
      b: "${OMNI_TEST_KEY}",
      c: ["${OMNI_TEST_KEY}", "plain"],
      d: { nested: "${OMNI_TEST_KEY}" },
    }
    const out = expandEnvDeep(input)
    expect(out).toEqual({
      a: "literal",
      b: "secret",
      c: ["secret", "plain"],
      d: { nested: "secret" },
    })
    delete process.env.OMNI_TEST_KEY
  })
})
