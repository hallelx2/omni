#!/usr/bin/env bun
/**
 * Omni CLI entry point.
 *
 * By default mounts the opentui-based TUI. Falls back to the plain
 * readline REPL when:
 *   - `--plain` is in argv (explicit)
 *   - stdout isn't a TTY (piped output, CI, redirects)
 *   - `OMNI_PLAIN=1` is set in the environment
 */
const usePlain =
  process.argv.includes("--plain") ||
  process.env.OMNI_PLAIN === "1" ||
  !process.stdout.isTTY

if (usePlain) {
  // Importing plain.ts runs the legacy readline REPL via its top-level
  // await. It owns its own process.exit, so we never return here.
  await import("./plain.ts")
} else {
  const { runTui } = await import("./tui/main.tsx")
  await runTui()
}
