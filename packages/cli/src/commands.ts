import type { Engine } from "@omni/core"
import type { ModelProfile, AdaptedStrategy, Skill } from "@omni/improve"
import type { MCPManager } from "@omni/tools"
import type { SessionsRepo, MessagesRepo } from "@omni/storage"
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
  readonly mcpManager?: MCPManager
  readonly sessionsRepo?: SessionsRepo
  readonly messagesRepo?: MessagesRepo
  readonly onContinueSession?: (sessionId: string) => boolean
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
    name: "sessions",
    description: "List recent sessions persisted in ~/.omni/db.sqlite",
    async run(args, ctx) {
      if (!ctx.sessionsRepo || !ctx.messagesRepo) {
        return { kind: "message", text: ansi.dim("(sessions repo not initialized)") }
      }
      const limit = parseInt(parseArgs(args)[0] ?? "20", 10) || 20
      const rows = ctx.sessionsRepo.list({ limit })
      if (rows.length === 0) {
        return { kind: "message", text: ansi.dim("(no sessions yet)") }
      }
      const lines = rows.map((r) => {
        const when = new Date(r.updated_at).toISOString().slice(0, 19).replace("T", " ")
        const msgs = ctx.messagesRepo!.countBySession(r.id)
        const color =
          r.status === "completed" ? ansi.green :
          r.status === "active"    ? ansi.cyan  :
          r.status === "failed"    ? ansi.red   : ansi.dim
        const active = r.id === ctx.engine.sessionId() ? ansi.bold(" ←current") : ""
        return `  ${color("●")} ${r.id} ${ansi.dim(when)} ${ansi.dim(`(${r.model_id}, ${msgs} msgs, ${r.status})`)}${active}`
      })
      lines.push("", ansi.dim("`/continue <id>` to resume one"))
      return { kind: "message", text: lines.join("\n") }
    },
  },
  {
    name: "continue",
    description: "Resume a past session by id (use `/sessions` to find ids)",
    async run(args, ctx) {
      if (!ctx.onContinueSession) {
        return { kind: "message", text: ansi.dim("(continuation not wired up)") }
      }
      const id = parseArgs(args)[0]
      if (!id) {
        return { kind: "message", text: ansi.red("usage: /continue <sessionId>") }
      }
      const ok = ctx.onContinueSession(id)
      if (!ok) {
        return {
          kind: "message",
          text: ansi.red(`session ${id} not found`),
        }
      }
      return {
        kind: "message",
        text: `${ansi.green("→")} resumed session ${ansi.bold(id)}`,
      }
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
  {
    name: "skills",
    description: "List available skills",
    async run(_args, ctx) {
      const skills = ctx.skills
      if (!skills || skills.size === 0) {
        return {
          kind: "message",
          text: ansi.dim(
            "No skills found. Create one with `mkdir -p ~/.omni/skills/<name> && $EDITOR ~/.omni/skills/<name>/SKILL.md`",
          ),
        }
      }
      const lines = [...skills.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => {
          const active = ctx.activeSkill?.name === s.name ? ansi.green(" ●") : ""
          const tools =
            s.toolsOnly && s.toolsOnly.length > 0
              ? ` ${ansi.dim(`(tools: ${s.toolsOnly.length})`)}`
              : ""
          const trig =
            s.triggers.length > 0
              ? `\n    ${ansi.dim("triggers:")} ${s.triggers.map((t) => `"${t}"`).join(", ")}`
              : ""
          return `  ${ansi.bold(s.name)}${active} ${ansi.dim("[" + s.source + "]")}${tools}\n    ${s.description}${trig}`
        })
      return { kind: "message", text: lines.join("\n\n") }
    },
  },
  {
    name: "skill",
    description: "Activate a skill (`/skill <name>`, `/skill off` to clear, `/skill` to show current)",
    async run(args, ctx) {
      if (!ctx.skills || !ctx.onSkillChange) {
        return { kind: "message", text: ansi.dim("(skills not initialized)") }
      }
      const name = parseArgs(args)[0]
      if (!name) {
        if (!ctx.activeSkill) {
          return { kind: "message", text: ansi.dim("(no active skill)") }
        }
        return {
          kind: "message",
          text: `active: ${ansi.bold(ctx.activeSkill.name)} ${ansi.dim("[" + ctx.activeSkill.source + "]")}`,
        }
      }
      if (name === "off" || name === "clear" || name === "none") {
        ctx.onSkillChange(null)
        return { kind: "message", text: ansi.dim("skill cleared") }
      }
      const skill = ctx.skills.get(name)
      if (!skill) {
        return {
          kind: "message",
          text: ansi.red(`unknown skill: ${name}. Try /skills to list available skills.`),
        }
      }
      ctx.onSkillChange(skill)
      return {
        kind: "message",
        text: `${ansi.green("→")} skill activated: ${ansi.bold(skill.name)}`,
      }
    },
  },
  {
    name: "mcp",
    description: "Manage MCP servers: /mcp (list), /mcp tools, /mcp restart <name>",
    async run(args, ctx) {
      const mgr = ctx.mcpManager
      if (!mgr) {
        return { kind: "message", text: ansi.dim("(MCP manager not initialized)") }
      }
      const [sub, ...rest] = parseArgs(args)
      if (!sub) {
        const states = mgr.status()
        if (states.length === 0) {
          return {
            kind: "message",
            text: ansi.dim(
              "No MCP servers configured. Add servers under `mcp.servers` in ~/.omni/config.json.",
            ),
          }
        }
        const lines = states.map((s) => {
          const color =
            s.status === "connected"
              ? ansi.green
              : s.status === "failed"
                ? ansi.red
                : s.status === "connecting"
                  ? ansi.yellow
                  : ansi.dim
          const detail =
            s.status === "connected"
              ? `${s.toolCount} tool${s.toolCount === 1 ? "" : "s"}`
              : s.status === "failed"
                ? s.error ?? ""
                : s.status
          return `  ${color("●")} ${s.name.padEnd(20)} ${ansi.dim(detail)}`
        })
        return { kind: "message", text: lines.join("\n") }
      }
      if (sub === "tools") {
        const tools = mgr.tools()
        if (tools.length === 0) {
          return { kind: "message", text: ansi.dim("(no MCP tools currently registered)") }
        }
        const lines = tools.map(
          (t) => `  ${ansi.cyan(t.name).padEnd(32)} ${ansi.dim(t.description.slice(0, 80))}`,
        )
        return { kind: "message", text: lines.join("\n") }
      }
      if (sub === "restart") {
        const name = rest[0]
        if (!name) {
          return { kind: "message", text: ansi.red("usage: /mcp restart <name>") }
        }
        try {
          await mgr.restart(name)
          return { kind: "message", text: `${ansi.green("✓")} restarted ${name}` }
        } catch (e) {
          return { kind: "message", text: ansi.red(`failed: ${(e as Error).message}`) }
        }
      }
      return { kind: "message", text: ansi.red(`unknown subcommand: ${sub}`) }
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
