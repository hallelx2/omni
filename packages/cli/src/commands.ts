import type { Engine } from "@omni/core"
import type { ModelProfile, AdaptedStrategy, Skill } from "@omni/improve"
import { ansi } from "./ansi.ts"
import {
  loadUserCommands,
  parseArgs,
  renderCommand,
  type UserCommand,
} from "./user-commands.ts"

export interface CommandContext {
  readonly engine: Engine
  readonly modelName: string
  readonly profile?: ModelProfile | null
  readonly strategy?: AdaptedStrategy | null
  readonly skills?: Map<string, Skill>
  readonly activeSkill?: Skill | null
  readonly onSkillChange?: (skill: Skill | null) => void
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
  /** Sent by user-defined commands: caller should run this through the engine. */
  | { readonly kind: "prompt"; readonly text: string }

const COMMANDS: readonly SlashCommand[] = [
  {
    name: "help",
    description: "List available commands",
    async run() {
      const builtinLines = COMMANDS.map(
        (c) => `  ${ansi.cyan("/" + c.name).padEnd(28)} ${ansi.dim(c.description)}`,
      )
      const users = userCommands()
      const userLines = [...users.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(
          (c) =>
            `  ${ansi.magenta("/" + c.name).padEnd(28)} ${ansi.dim(c.description || c.template.slice(0, 60))} ${ansi.dim("[" + c.source + "]")}`,
        )
      const out = [`${ansi.bold("Built-in commands")}`, ...builtinLines]
      if (userLines.length > 0) {
        out.push("", `${ansi.bold("User commands")}`, ...userLines)
      }
      return { kind: "message", text: out.join("\n") }
    },
  },
  {
    name: "commands",
    description: "List user-defined slash commands (alias for the user section of /help)",
    async run() {
      const users = userCommands()
      if (users.size === 0) {
        return {
          kind: "message",
          text: ansi.dim(
            "No user commands. Create one with `mkdir -p ~/.omni/commands && $EDITOR ~/.omni/commands/foo.md`",
          ),
        }
      }
      const lines = [...users.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => {
          const argsHint = c.args.length
            ? " " +
              c.args
                .map((a) => (a.optional ? `[${a.name}]` : `<${a.name}>`))
                .join(" ")
            : ""
          return [
            `  ${ansi.bold("/" + c.name)}${argsHint}  ${ansi.dim("[" + c.source + "]")}`,
            c.description ? `    ${c.description}` : "",
            `    ${ansi.dim(c.path)}`,
          ]
            .filter(Boolean)
            .join("\n")
        })
      return { kind: "message", text: lines.join("\n\n") }
    },
  },
  {
    name: "reload-commands",
    description: "Re-scan ~/.omni/commands/ and workspace .omni/commands/",
    async run() {
      const cmds = reloadUserCommands()
      return { kind: "message", text: `Loaded ${cmds.size} user command(s).` }
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

/**
 * Lazily-loaded user commands. Refresh by calling reloadUserCommands().
 */
let _userCommandCache: Map<string, UserCommand> | null = null
export function userCommands(): Map<string, UserCommand> {
  if (!_userCommandCache) _userCommandCache = loadUserCommands()
  return _userCommandCache
}
export function reloadUserCommands(): Map<string, UserCommand> {
  _userCommandCache = loadUserCommands()
  return _userCommandCache
}

/** Parse and dispatch. Returns null if input wasn't a slash command. */
export async function tryDispatchCommand(
  input: string,
  ctx: CommandContext,
): Promise<CommandResult | null> {
  if (!input.startsWith("/")) return null
  // First token is the command name; everything after is parsed via parseArgs
  // so quoted strings are respected.
  const rest = input.slice(1)
  const firstSpace = rest.search(/\s/)
  const name = firstSpace === -1 ? rest : rest.slice(0, firstSpace)
  const argString = firstSpace === -1 ? "" : rest.slice(firstSpace + 1)
  const args = parseArgs(argString)

  // Built-ins take precedence
  const builtin = COMMANDS.find((c) => c.name === name)
  if (builtin) return builtin.run(argString, ctx)

  // User-defined commands
  const user = userCommands().get(name)
  if (user) {
    return { kind: "prompt", text: renderCommand(user, args) }
  }

  return {
    kind: "message",
    text: `Unknown command: /${name}. Try /help`,
  }
}

export function listCommands(): readonly SlashCommand[] {
  return COMMANDS
}
