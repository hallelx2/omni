import type { Engine } from "@omni/core"
import type { ModelProfile, AdaptedStrategy } from "@omni/improve"
import { ansi } from "./ansi.ts"

export interface CommandContext {
  readonly engine: Engine
  readonly modelName: string
  readonly profile?: ModelProfile | null
  readonly strategy?: AdaptedStrategy | null
}

export interface SlashCommand {
  readonly name: string
  readonly description: string
  run(args: string, ctx: CommandContext): Promise<CommandResult>
}

export type CommandResult =
  | { readonly kind: "continue" }
  | { readonly kind: "exit" }
  | { readonly kind: "message"; readonly text: string }

const COMMANDS: readonly SlashCommand[] = [
  {
    name: "help",
    description: "List available commands",
    async run() {
      const lines = COMMANDS.map(
        (c) => `  ${ansi.cyan("/" + c.name).padEnd(28)} ${ansi.dim(c.description)}`,
      )
      return {
        kind: "message",
        text: `${ansi.bold("Commands")}\n${lines.join("\n")}`,
      }
    },
  },
  {
    name: "quit",
    description: "Exit the CLI",
    async run() {
      return { kind: "exit" }
    },
  },
  {
    name: "exit",
    description: "Exit the CLI",
    async run() {
      return { kind: "exit" }
    },
  },
  {
    name: "history",
    description: "Show the conversation history (compact)",
    async run(_args, ctx) {
      const lines = ctx.engine
        .history()
        .map((m) => `  ${ansi.bold(`[${m.role}]`)} ${(m.content || "").slice(0, 200)}`)
      return { kind: "message", text: lines.join("\n") || "(empty)" }
    },
  },
  {
    name: "usage",
    description: "Show cumulative token usage",
    async run(_args, ctx) {
      const u = ctx.engine.usage()
      return {
        kind: "message",
        text: `tokens: ${u.totalTokens} (in=${u.promptTokens}, out=${u.completionTokens}), calls=${u.callCount}${u.costUsd ? `, $${u.costUsd.toFixed(4)}` : ""}`,
      }
    },
  },
  {
    name: "session",
    description: "Show current sessionId",
    async run(_args, ctx) {
      return { kind: "message", text: `sessionId: ${ctx.engine.sessionId()}` }
    },
  },
  {
    name: "model",
    description: "Show the active model",
    async run(_args, ctx) {
      return { kind: "message", text: `model: ${ctx.modelName}` }
    },
  },
  {
    name: "paths",
    description: "Show resolved Omni paths (home, db, traces, memory, config)",
    async run() {
      const { omniPaths, workspacePaths } = await import("@omni/core")
      const p = omniPaths()
      const w = workspacePaths()
      const lines = [
        `  home:     ${p.home}`,
        `  config:   ${p.config}`,
        `  db:       ${p.db}`,
        `  traces:   ${p.traces}`,
        `  memory:   ${p.memory}`,
        `  settings: ${p.settings}`,
      ]
      if (w) {
        lines.push(``, `  workspace:`, `    home:     ${w.home}`, `    config:   ${w.config}`,
          `    commands: ${w.commands}`, `    skills:   ${w.skills}`, `    hooks:    ${w.hooks}`)
      } else {
        lines.push(``, `  workspace: (none)`)
      }
      return { kind: "message", text: lines.join("\n") }
    },
  },
  {
    name: "profile",
    description: "Show the probed capability profile + adapted strategy for the current model",
    async run(_args, ctx) {
      if (!ctx.profile || !ctx.strategy) {
        return { kind: "message", text: ansi.dim("(no profile — running on mock adapter or probe failed)") }
      }
      const p = ctx.profile
      const s = ctx.strategy
      const lines: string[] = []
      lines.push(`${ansi.bold("Profile")} ${ansi.dim(`(${p.modelId})`)}`)
      lines.push(`  probed:               ${new Date(p.probedAt).toISOString()}`)
      lines.push(`  nativeToolCalls:      ${p.nativeToolCalls ? ansi.green("yes") : ansi.red("no")}`)
      lines.push(`  followsInstructions:  ${p.followsInstructions ? ansi.green("yes") : ansi.red("no")}`)
      lines.push(`  verboseByDefault:     ${p.verboseByDefault ? ansi.yellow("yes") : "no"}`)
      lines.push(`  averageLatencyMs:     ${p.averageLatencyMs.toFixed(0)}`)
      lines.push(`  errorRate:            ${(p.errorRate * 100).toFixed(0)}%`)
      lines.push(``)
      lines.push(`${ansi.bold("Strategy")}`)
      lines.push(`  enableReActFallback:  ${s.enableReActFallback}`)
      lines.push(`  maxIterations:        ${s.maxIterations}`)
      lines.push(`  usePlanner:           ${s.usePlanner}`)
      lines.push(`  useCritic:            ${s.useCritic}`)
      lines.push(`  reserveOutputTokens:  ${s.reserveOutputTokens}`)
      lines.push(``)
      lines.push(`${ansi.bold("Rationale")}`)
      for (const r of s.rationale) lines.push(`  ${ansi.dim("·")} ${r}`)
      return { kind: "message", text: lines.join("\n") }
    },
  },
]

/** Parse and dispatch. Returns null if input wasn't a slash command. */
export async function tryDispatchCommand(
  input: string,
  ctx: CommandContext,
): Promise<CommandResult | null> {
  if (!input.startsWith("/")) return null
  const [name, ...rest] = input.slice(1).split(/\s+/)
  const args = rest.join(" ")
  const cmd = COMMANDS.find((c) => c.name === name)
  if (!cmd) {
    return {
      kind: "message",
      text: `Unknown command: /${name}. Try /help`,
    }
  }
  return cmd.run(args, ctx)
}

export function listCommands(): readonly SlashCommand[] {
  return COMMANDS
}
