import type { Engine } from "@omni/core"
import { ansi } from "./ansi.ts"

export interface CommandContext {
  readonly engine: Engine
  readonly modelName: string
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
      // Lazy require to avoid circular imports at module load
      const { omniPaths } = await import("@omni/core")
      const p = omniPaths()
      return {
        kind: "message",
        text: [
          `  home:     ${p.home}`,
          `  config:   ${p.config}`,
          `  db:       ${p.db}`,
          `  traces:   ${p.traces}`,
          `  memory:   ${p.memory}`,
          `  settings: ${p.settings}`,
        ].join("\n"),
      }
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
