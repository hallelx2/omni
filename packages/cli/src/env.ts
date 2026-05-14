import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * Load `.env` from one or more candidate paths, overriding any pre-set
 * environment variables. Bun's auto-loader respects shell env first; this
 * inverts that precedence for the harness's own keys.
 */
export function loadDotenv(candidatePaths: readonly string[]): void {
  for (const p of candidatePaths) {
    const abs = resolve(p)
    if (!existsSync(abs)) continue
    const raw = readFileSync(abs, "utf8")
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
    break // first found wins
  }
}
