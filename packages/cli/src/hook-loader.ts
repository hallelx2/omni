import { resolve, isAbsolute } from "node:path"
import { homedir } from "node:os"
import type { Config, HookModule } from "@omni/core"
import type { Tool, ToolCall, ToolContext } from "@omni/core"

/**
 * Load hooks declared in config. Two flavors are supported:
 *
 * 1. Shell hooks — a shell command runs at a lifecycle moment. The event
 *    payload is passed on stdin as JSON. Non-zero exit on `preToolUse`
 *    blocks the tool call.
 *
 *    ```json
 *    "hooks": [
 *      { "event": "preToolUse", "match": { "tool": "bash" },
 *        "command": "~/.omni/hooks/log-shell.sh" }
 *    ]
 *    ```
 *
 * 2. Module hooks — a TypeScript/JavaScript file exporting a HookModule.
 *
 *    ```json
 *    "hooks": [ { "module": "~/.omni/hooks/redact.ts" } ]
 *    ```
 */
export async function loadHooks(config: Config): Promise<HookModule[]> {
  const out: HookModule[] = []
  for (const decl of config.hooks ?? []) {
    if ("module" in decl) {
      const mod = await loadModuleHook(decl.module)
      if (mod) out.push(mod)
    } else {
      out.push(buildShellHook(decl))
    }
  }
  return out
}

function expandTilde(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return p.replace(/^~/, homedir())
  }
  return p
}

async function loadModuleHook(modulePath: string): Promise<HookModule | null> {
  const abs = isAbsolute(modulePath) ? modulePath : resolve(expandTilde(modulePath))
  try {
    const imported = (await import(abs)) as { default?: HookModule }
    const mod = imported.default ?? (imported as unknown as HookModule)
    if (!mod || typeof mod !== "object") return null
    return mod
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`hook module ${modulePath} failed to load: ${(e as Error).message}`)
    return null
  }
}

interface ShellHookDecl {
  readonly event: "preToolUse" | "postToolUse" | "preModel" | "onError" | "onSessionStart" | "onSessionEnd"
  readonly match?: { readonly tool?: string }
  readonly command: string
  readonly timeoutMs?: number
}

function buildShellHook(decl: ShellHookDecl): HookModule {
  const expand = expandTilde(decl.command)
  const timeout = decl.timeoutMs ?? 5_000

  async function exec(payload: unknown): Promise<{ exitCode: number; stdout: string }> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    try {
      const argv = process.platform === "win32"
        ? ["powershell", "-NoProfile", "-Command", expand]
        : ["bash", "-lc", expand]
      const proc = Bun.spawn(argv, {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
        signal: ctrl.signal,
      })
      proc.stdin.write(JSON.stringify(payload))
      proc.stdin.end()
      const [stdout, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        proc.exited,
      ])
      return { exitCode, stdout }
    } finally {
      clearTimeout(timer)
    }
  }

  const toolMatches = (tool: Tool): boolean => {
    if (!decl.match?.tool) return true
    return tool.name === decl.match.tool
  }

  const hook: HookModule = { name: `shell:${decl.event}:${decl.command.slice(0, 30)}` }

  if (decl.event === "preToolUse") {
    hook.preToolUse = async (tool: Tool, call: ToolCall, _ctx: ToolContext) => {
      if (!toolMatches(tool)) return
      try {
        const r = await exec({ tool: tool.name, call })
        if (r.exitCode !== 0) {
          return { continue: false, reason: r.stdout.trim() || "blocked by shell hook" }
        }
        if (r.stdout.trim().startsWith("{")) {
          try {
            const parsed = JSON.parse(r.stdout) as { args?: unknown }
            if (parsed.args !== undefined) return { args: parsed.args }
          } catch {
            // hook returned non-JSON, fall through
          }
        }
      } catch {
        // hook timeout/error → fail open (don't block)
      }
    }
  } else if (decl.event === "postToolUse") {
    hook.postToolUse = async (tool: Tool, call: ToolCall, result: unknown) => {
      if (!toolMatches(tool)) return
      try {
        await exec({ tool: tool.name, call, result })
      } catch {
        // ignore
      }
    }
  } else if (decl.event === "onSessionStart") {
    hook.onSessionStart = async (sessionId) => {
      try {
        await exec({ sessionId })
      } catch {
        // ignore
      }
    }
  } else if (decl.event === "onSessionEnd") {
    hook.onSessionEnd = async (sessionId, reason) => {
      try {
        await exec({ sessionId, reason })
      } catch {
        // ignore
      }
    }
  }
  // onError + preModel shell hooks omitted intentionally: payloads are
  // larger than is convenient for stdin-IPC and they're rarely needed.
  // Module hooks cover those events cleanly.

  return hook
}
