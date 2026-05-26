/**
 * Run modes shared across both CLI surfaces.
 *
 *   - "build" (default): full tool access; the critic reviews each turn; tools
 *                        with `permission: "ask"` prompt the user.
 *   - "plan":  read-only tools only; the planner runs before the turn.
 *   - "auto":  full tool access AND ask-prompts auto-allow (unattended run).
 *              Safety guards (destructive-bash deny, optional workspace
 *              confinement) still apply via the layered permission gate.
 *
 * A single {@link ModeHolder} instance is created in bootstrap and handed to
 * both the plain REPL and the TUI, so a switch (manual `/mode`, an agent's
 * `request_build_mode`, the autoclassifier, or config) is visible everywhere.
 */
export type RunMode = "plan" | "auto" | "build"
export type ModeSource = "default" | "manual" | "auto" | "agent"

/**
 * Tools the model may call while in plan mode. Read-only investigation +
 * `ask_user` (clarify) + the escape hatch to request build mode. The engine
 * enforces this via `enabledTools`.
 */
export const PLAN_MODE_TOOLS: ReadonlySet<string> = new Set([
  "read_file",
  "glob",
  "grep",
  "web_fetch",
  "ask_user",
  "request_build_mode",
])

export interface ModeHolder {
  get(): RunMode
  source(): ModeSource
  set(next: RunMode, source?: Exclude<ModeSource, "default">): void
  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(fn: (mode: RunMode, source: ModeSource) => void): () => void
}

export function createModeHolder(initial: RunMode): ModeHolder {
  let mode: RunMode = initial
  let src: ModeSource = "default"
  const subs = new Set<(mode: RunMode, source: ModeSource) => void>()
  return {
    get: () => mode,
    source: () => src,
    set(next, source = "manual") {
      if (next === mode) return
      mode = next
      src = source
      for (const fn of subs) {
        try {
          fn(mode, src)
        } catch {
          // a misbehaving subscriber must not break mode switching
        }
      }
    },
    subscribe(fn) {
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
  }
}
