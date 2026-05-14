#!/usr/bin/env bun
/**
 * Tiny end-to-end driver for exercising the engine + adapters from the CLI.
 *
 * Picks an adapter based on environment:
 *   - OMNI_ADAPTER=mock       (default) — scripted MockAdapter
 *   - OMNI_ADAPTER=mimo       — needs MIMO_API_KEY (+ optional OMNI_MODEL)
 *   - OMNI_ADAPTER=ollama     — needs OMNI_MODEL (e.g. "qwen2.5-coder:7b")
 *   - OMNI_ADAPTER=anthropic  — needs ANTHROPIC_API_KEY (+ OMNI_MODEL)
 *   - OMNI_ADAPTER=openai     — needs OPENAI_API_KEY (+ OMNI_MODEL)
 *
 * Usage:
 *   bun run packages/cli-driver/src/index.ts "your request here"
 *
 * `.env` at the workspace root is loaded explicitly here so its values
 * override any stale variables already set in the shell.
 */
import { resolve, dirname } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Engine, AllowAllPermissions, type ModelAdapter } from "@omni/core"

// ─── Load .env from workspace root, overriding shell vars ─────────────────
const __filename = fileURLToPath(import.meta.url)
const workspaceRoot = resolve(dirname(__filename), "..", "..", "..")
const envPath = resolve(workspaceRoot, ".env")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}
import {
  MockAdapter,
  type MockScript,
  mimo,
  ollama,
  AnthropicAdapter,
  OpenAIAdapter,
} from "@omni/adapters"
import { bash, readFile, writeFile, edit, multiEdit, glob, grep, webFetch } from "@omni/tools"

const userInput = process.argv.slice(2).join(" ") || "list files in the current directory"
const which = (process.env.OMNI_ADAPTER ?? "mock").toLowerCase()

function pickAdapter(): ModelAdapter {
  switch (which) {
    case "mimo": {
      const apiKey = process.env.MIMO_API_KEY
      if (!apiKey) throw new Error("OMNI_ADAPTER=mimo requires MIMO_API_KEY")
      const model = process.env.OMNI_MODEL ?? "mimo-v2.5-pro"
      const baseURL = process.env.MIMO_BASE_URL
      return mimo({ apiKey, model, baseURL })
    }
    case "mimo-anthropic": {
      const apiKey = process.env.MIMO_API_KEY
      if (!apiKey) throw new Error("OMNI_ADAPTER=mimo-anthropic requires MIMO_API_KEY")
      const model = process.env.OMNI_MODEL ?? "mimo-v2.5-pro"
      const baseURL = process.env.MIMO_BASE_URL_ANTHROPIC
      return new AnthropicAdapter({ apiKey, model, baseURL })
    }
    case "ollama": {
      const model = process.env.OMNI_MODEL ?? "qwen2.5-coder:7b"
      const baseURL = process.env.OLLAMA_BASE_URL
      return ollama({ model, baseURL })
    }
    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) throw new Error("OMNI_ADAPTER=anthropic requires ANTHROPIC_API_KEY")
      const model = process.env.OMNI_MODEL ?? "claude-sonnet-4-5"
      return new AnthropicAdapter({ apiKey, model })
    }
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) throw new Error("OMNI_ADAPTER=openai requires OPENAI_API_KEY")
      const model = process.env.OMNI_MODEL ?? "gpt-4o-mini"
      return new OpenAIAdapter({ apiKey, model })
    }
    case "mock":
    default: {
      const script: MockScript[] = [
        { kind: "tool", name: "bash", args: { command: "echo hello from omni && pwd" } },
        { kind: "text", text: "Done. The shell ran successfully in the working directory above." },
      ]
      return new MockAdapter({ script, deltaMs: 8 })
    }
  }
}

const adapter = pickAdapter()

// Test driver allows everything. The interactive permission UI lives in
// Aspect 10 (Solid + opentui CLI).
const engine = new Engine({
  model: adapter,
  tools: [bash, readFile, writeFile, edit, multiEdit, glob, grep, webFetch],
  permissions: new AllowAllPermissions(),
  systemPrompt:
    "You are Omni, a self-improving agent. Be terse. Use tools to gather information; don't speculate.",
  maxIterations: 8,
  enableReActFallback: true,
})

const ac = new AbortController()
process.on("SIGINT", () => {
  console.error("\n[ctrl-c] aborting...")
  ac.abort()
})

console.log(`[adapter: ${adapter.name} (${adapter.id}) — ctx ${adapter.capabilities.contextWindow}]`)
console.log(`User: ${userInput}\n`)

for await (const ev of engine.run(userInput, { signal: ac.signal })) {
  switch (ev.type) {
    case "engine.iteration":
      console.log(`\n[iter ${ev.iteration}/${ev.maxIterations}]`)
      break
    case "model.start":
      process.stdout.write("assistant: ")
      break
    case "model.thinking_delta":
      process.stdout.write(`\x1b[2m${ev.text}\x1b[0m`)
      break
    case "model.delta":
      process.stdout.write(ev.text)
      break
    case "model.tool_call_done":
      console.log(`\n  proposed tool: ${ev.call.name}(${truncate(JSON.stringify(ev.call.args), 200)})`)
      break
    case "model.done":
      process.stdout.write("\n")
      break
    case "tool.permission_requested":
      if (ev.tool.permission !== "auto") {
        console.log(`  ? permission: ${ev.tool.name} (${ev.tool.permission})`)
      }
      break
    case "tool.permission_denied":
      console.log(`  ! permission denied: ${ev.call.name}`)
      break
    case "tool.start":
      console.log(`  -> executing ${ev.call.name}...`)
      break
    case "tool.progress":
      console.log(`     · ${ev.message}`)
      break
    case "tool.result":
      console.log(`  <- (${ev.durationMs}ms) ${truncate(stringify(ev.result), 240)}`)
      break
    case "tool.error":
      console.log(`  !! (${ev.durationMs}ms) ${ev.call.name}: ${ev.error.message} [${ev.error.category}]`)
      break
    case "tool.invalid":
      console.log(`  !! invalid: ${ev.reason}`)
      break
    case "engine.usage":
      console.log(
        `  [usage] +${ev.delta.totalTokens} tokens (total ${ev.total.totalTokens}, calls ${ev.total.callCount})`,
      )
      break
    case "engine.retrying":
      console.log(`  [retry] attempt ${ev.attempt}, waiting ${ev.delayMs}ms (${ev.reason})`)
      break
    case "engine.loop_detected":
      console.log(`  [loop] same call set ${ev.occurrences}× in a row — stopping`)
      break
    case "engine.warning":
      console.log(`  [warn:${ev.category}] ${ev.message}`)
      break
    case "engine.error":
      console.error(`\n[error] ${ev.error.category}: ${ev.error.message}`)
      break
    case "engine.done":
      console.log(`\n[done: ${ev.reason} in ${ev.durationMs}ms — ${ev.usage.totalTokens} tokens]`)
      break
    default:
      break
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}...` : s
}
function stringify(v: unknown): string {
  if (typeof v === "string") return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}
