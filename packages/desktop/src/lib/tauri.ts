/**
 * Thin Tauri bridge. Everything degrades gracefully in a plain browser so the
 * UI can be developed with `vite dev` against a standalone sidecar.
 */
export interface ServerInfo {
  baseUrl: string
  wsUrl: string
  token: string | null
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

/** Where the sidecar lives. In Tauri, ask Rust (which spawned it); else dev default. */
export async function getServerInfo(): Promise<ServerInfo> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core")
    // The sidecar may still be binding when the webview first loads; retry the
    // handshake for a few seconds before giving up.
    let lastErr: unknown
    for (let i = 0; i < 40; i++) {
      try {
        const info = await invoke<{ port: number; token: string | null }>("server_info")
        return {
          baseUrl: `http://127.0.0.1:${info.port}`,
          wsUrl: `ws://127.0.0.1:${info.port}/ws`,
          token: info.token,
        }
      } catch (e) {
        lastErr = e
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("omni server did not start")
  }
  const port = Number(import.meta.env.VITE_OMNI_PORT ?? 8137)
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    token: import.meta.env.VITE_OMNI_TOKEN ?? null,
  }
}

/** Native folder picker (Tauri). Returns null when cancelled or unavailable. */
export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) return null
  const { open } = await import("@tauri-apps/plugin-dialog")
  const result = await open({ directory: true, multiple: false, title: "Open project folder" })
  return typeof result === "string" ? result : null
}

export type WindowAction = "minimize" | "toggleMaximize" | "close"

export async function windowAction(action: WindowAction): Promise<void> {
  if (!isTauri()) return
  const { getCurrentWindow } = await import("@tauri-apps/api/window")
  const w = getCurrentWindow()
  if (action === "minimize") await w.minimize()
  else if (action === "toggleMaximize") await w.toggleMaximize()
  else await w.close()
}
