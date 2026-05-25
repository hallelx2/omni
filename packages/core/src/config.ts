import { z } from "zod"
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { omniConfigPath, omniHome, workspaceOmniDir } from "./paths.ts"

/**
 * User-level configuration persisted in `~/.omni/config.json`. Read at CLI
 * startup; environment variables take precedence (so secrets needn't live in
 * the config file).
 *
 * All fields optional. The schema validates types; loaders fill defaults.
 */
export const ConfigSchema = z.object({
  adapter: z
    .enum(["mock", "mimo", "mimo-anthropic", "ollama", "anthropic", "openai", "google"])
    .optional(),
  model: z.string().optional(),
  systemPrompt: z.string().optional(),
  maxIterations: z.number().int().positive().optional(),
  enableReActFallback: z.boolean().optional(),

  providers: z
    .object({
      mimo: z.object({ apiKey: z.string().optional(), baseURL: z.string().optional() }).optional(),
      "mimo-anthropic": z
        .object({ apiKey: z.string().optional(), baseURL: z.string().optional() })
        .optional(),
      ollama: z.object({ baseURL: z.string().optional() }).optional(),
      anthropic: z
        .object({ apiKey: z.string().optional(), baseURL: z.string().optional() })
        .optional(),
      openai: z.object({ apiKey: z.string().optional(), baseURL: z.string().optional() }).optional(),
      google: z.object({ apiKey: z.string().optional() }).optional(),
    })
    .optional(),

  permissions: z
    .object({
      mode: z.enum(["allow_all", "deny_all", "ask", "rules"]).optional(),
      /** Tool names auto-allowed without prompting (applied after safety denies). */
      autoAllow: z.array(z.string()).optional(),
      /** Deny obviously destructive bash on the main engine. Default true. */
      denyDestructive: z.boolean().optional(),
      /** Confine file tools + bash to the workspace/cwd. Default false. */
      restrictToWorkspace: z.boolean().optional(),
    })
    .optional(),

  /** Context-window compaction strategy and tuning. */
  context: z
    .object({
      /**
       * How history is fit into the window. Default "budget" (drops the oldest
       * messages). "summarize" compacts older turns with the model instead of
       * dropping them; "sliding" keeps only the most recent messages.
       */
      compaction: z.enum(["summarize", "budget", "sliding"]).optional(),
      /** Model ref for the summariser (e.g. "anthropic:claude…"); defaults to the main model. */
      summarizerModel: z.string().optional(),
      /** Recent messages always kept verbatim when summarizing. Default 8. */
      keepRecent: z.number().int().positive().optional(),
      /** Token level above which summarization runs. Default ~80% of the window. */
      summarizeAboveTokens: z.number().int().positive().optional(),
    })
    .optional(),

  ui: z
    .object({
      theme: z.enum(["dark", "light", "auto"]).optional(),
      showThinking: z.boolean().optional(),
    })
    .optional(),

  storage: z
    .object({
      tracesEnabled: z.boolean().optional(),
    })
    .optional(),

  mcp: z
    .object({
      servers: z
        .record(
          z.string(),
          z.discriminatedUnion("kind", [
            z.object({
              kind: z.literal("stdio"),
              command: z.string(),
              args: z.array(z.string()).optional(),
              env: z.record(z.string(), z.string()).optional(),
              cwd: z.string().optional(),
              permission: z.enum(["auto", "ask", "deny"]).optional(),
              prefix: z.string().optional(),
            }),
            z.object({
              kind: z.literal("http"),
              url: z.string(),
              headers: z.record(z.string(), z.string()).optional(),
              permission: z.enum(["auto", "ask", "deny"]).optional(),
              prefix: z.string().optional(),
            }),
          ]),
        )
        .optional(),
    })
    .optional(),

  hooks: z
    .array(
      z.union([
        z.object({
          event: z.enum(["preToolUse", "postToolUse", "preModel", "onError", "onSessionStart", "onSessionEnd"]),
          match: z
            .object({
              tool: z.string().optional(),
            })
            .optional(),
          command: z.string(),
          timeoutMs: z.number().int().positive().optional(),
        }),
        z.object({
          module: z.string(),
        }),
      ]),
    )
    .optional(),

  skills: z
    .object({
      enabled: z.array(z.string()).optional(),
      disabled: z.array(z.string()).optional(),
      autoRoute: z.boolean().optional(),
    })
    .optional(),

  /**
   * Verifiers (CRITIC pattern) run after tools to catch failures without
   * asking the model to grade itself. Two built-ins are on by default
   * (cheap); two require config to enable (expensive shells).
   */
  verifiers: z
    .object({
      /** Disable the cheap built-ins (patch-applies, file-parses). Default: enabled. */
      disableBuiltins: z.boolean().optional(),
      /** TypecheckVerifier — runs `tsc --noEmit` (or `command`) after file edits. */
      typecheck: z
        .object({
          enabled: z.boolean().optional(),
          command: z.string().optional(),
          cwd: z.string().optional(),
          timeoutMs: z.number().int().positive().optional(),
          appliesTo: z.array(z.string()).optional(),
        })
        .optional(),
      /** TestVerifier — runs `bun test` (or `command`) after file edits. */
      tests: z
        .object({
          enabled: z.boolean().optional(),
          command: z.string().optional(),
          cwd: z.string().optional(),
          timeoutMs: z.number().int().positive().optional(),
          appliesTo: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),

  /** Default run mode and mode behaviour. */
  modes: z
    .object({
      /** Startup mode. Default "build" (full tools). "plan" is read-only + planner. */
      default: z.enum(["plan", "build"]).optional(),
    })
    .optional(),

  /**
   * Prebuilt subagents, the parallel dispatch tool, and the planner/critic
   * that back plan/build mode. All optional; sane defaults applied at bootstrap.
   */
  agents: z
    .object({
      /** Master switch for agent tools + dispatch_agents. Default: enabled. */
      enabled: z.boolean().optional(),
      /** Agent names to exclude from the registry. */
      disabled: z.array(z.string()).optional(),
      /** Max simultaneous children in one dispatch_agents call (ceiling 8). */
      maxConcurrency: z.number().int().positive().max(8).optional(),
      planner: z
        .object({
          /** Force the planner on/off, overriding the probed strategy. */
          enabled: z.boolean().optional(),
          /** "provider:model" or bare model; defaults to the main model. */
          model: z.string().optional(),
          maxSteps: z.number().int().positive().optional(),
        })
        .optional(),
      critic: z
        .object({
          /** Force the critic on/off, overriding the probed strategy. */
          enabled: z.boolean().optional(),
          model: z.string().optional(),
          /** Feed a failing critique back as one follow-up turn. Default false. */
          autoRetry: z.boolean().optional(),
          retryBelow: z.number().min(0).max(1).optional(),
        })
        .optional(),
    })
    .optional(),
})

export type Config = z.infer<typeof ConfigSchema>

/**
 * Load `~/.omni/config.json` (or the override path). Returns `{}` when the
 * file doesn't exist. Invalid JSON or schema violations throw with a path
 * + message — never silently masked.
 */
export function loadConfig(path: string = omniConfigPath()): Config {
  if (!existsSync(path)) return {}
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (e) {
    throw new Error(`failed to read config at ${path}: ${(e as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`config is not valid JSON at ${path}: ${(e as Error).message}`)
  }
  const result = ConfigSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ")
    throw new Error(`config schema violation at ${path}: ${issues}`)
  }
  return result.data
}

/**
 * Save the given config to disk, creating the home directory if needed.
 * Pretty-printed JSON; safe to commit to a personal dotfiles repo (modulo
 * any provider keys you decided to put inline).
 */
export function saveConfig(config: Config, path: string = omniConfigPath()): void {
  const validated = ConfigSchema.parse(config)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(validated, null, 2) + "\n", "utf8")
}

/**
 * Ensure the Omni home directory exists. Returns the resolved path. Safe to
 * call repeatedly; idempotent.
 */
export function ensureOmniHome(): string {
  const home = omniHome()
  mkdirSync(home, { recursive: true })
  return home
}

/**
 * Resolve an adapter's apiKey by checking the standard precedence chain:
 *   1. explicit argument
 *   2. env var (provider-specific)
 *   3. config file (`providers.<name>.apiKey`)
 *
 * Returns `undefined` when nothing supplied. Adapters that don't need a key
 * (Ollama) should not call this.
 */
export function resolveApiKey(
  provider: "mimo" | "mimo-anthropic" | "anthropic" | "openai" | "google",
  config: Config,
  explicit?: string,
): string | undefined {
  if (explicit) return explicit
  const envKey: Record<typeof provider, string> = {
    mimo: "MIMO_API_KEY",
    "mimo-anthropic": "MIMO_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_API_KEY",
  }
  const fromEnv = process.env[envKey[provider]]
  if (fromEnv) return fromEnv
  return config.providers?.[provider]?.apiKey
}

/**
 * Load and merge user config with the workspace config (if any). The
 * workspace overrides the user for scalars; arrays concatenate; records
 * merge with workspace winning on key collision.
 *
 * Precedence chain: explicit args > env > workspace > user > defaults.
 */
export function loadMergedConfig(cwd?: string): Config {
  const user = loadConfig(omniConfigPath())
  const wsDir = workspaceOmniDir(cwd)
  if (!wsDir) return user
  const wsConfigPath = join(wsDir, "config.json")
  if (!existsSync(wsConfigPath)) return user
  const ws = loadConfig(wsConfigPath)
  return mergeConfigs(user, ws)
}

/**
 * Deep-merge two configs: scalars from `over` win; arrays from `over`
 * concatenate to `base`'s arrays; nested records merge recursively.
 *
 * Exported because consumers occasionally want to merge in additional
 * layers (e.g. an ephemeral session override on top of file-based config).
 */
export function mergeConfigs(base: Config, over: Config): Config {
  const out: Record<string, unknown> = { ...base }
  for (const [key, overVal] of Object.entries(over)) {
    if (overVal === undefined) continue
    const baseVal = (base as Record<string, unknown>)[key]
    if (Array.isArray(baseVal) && Array.isArray(overVal)) {
      out[key] = [...baseVal, ...overVal]
    } else if (isPlainObject(baseVal) && isPlainObject(overVal)) {
      out[key] = mergeRecord(baseVal, overVal)
    } else {
      out[key] = overVal
    }
  }
  return ConfigSchema.parse(out)
}

function mergeRecord(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue
    const b = base[k]
    if (Array.isArray(b) && Array.isArray(v)) {
      out[k] = [...b, ...v]
    } else if (isPlainObject(b) && isPlainObject(v)) {
      out[k] = mergeRecord(b, v)
    } else {
      out[k] = v
    }
  }
  return out
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

/**
 * Substitute `${VAR}` references with environment variables. Used by config
 * loaders (especially MCP server `env`/`headers`) so secrets stay in shell
 * env instead of config files.
 */
export function expandEnv(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => process.env[name] ?? "")
}

export function expandEnvDeep<T>(value: T): T {
  if (typeof value === "string") return expandEnv(value) as unknown as T
  if (Array.isArray(value)) return value.map(expandEnvDeep) as unknown as T
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = expandEnvDeep(v)
    return out as unknown as T
  }
  return value
}

/**
 * Same precedence chain for baseURL overrides.
 */
export function resolveBaseURL(
  provider: "mimo" | "mimo-anthropic" | "anthropic" | "openai" | "ollama",
  config: Config,
  explicit?: string,
): string | undefined {
  if (explicit) return explicit
  const envKey: Record<typeof provider, string> = {
    mimo: "MIMO_BASE_URL",
    "mimo-anthropic": "MIMO_BASE_URL_ANTHROPIC",
    anthropic: "ANTHROPIC_BASE_URL",
    openai: "OPENAI_BASE_URL",
    ollama: "OLLAMA_BASE_URL",
  }
  const fromEnv = process.env[envKey[provider]]
  if (fromEnv) return fromEnv
  // ts: providers.ollama doesn't have apiKey but does have baseURL
  return (config.providers?.[provider] as { baseURL?: string } | undefined)?.baseURL
}
