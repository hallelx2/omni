import { z } from "zod"
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { omniConfigPath, omniHome } from "./paths.ts"

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
      autoAllow: z.array(z.string()).optional(),
      denyDestructive: z.boolean().optional(),
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
