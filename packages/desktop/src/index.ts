/**
 * `@omni/desktop` — Tauri shell that bundles {@link OmniServer} as a sidecar
 * and loads `@omni/web`'s static client.
 *
 * Status: scaffold. The architecture is:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │  Tauri main window                          │
 *   │  ┌───────────────────────────────────────┐  │
 *   │  │  WebView2 (Edge) renders @omni/web    │  │
 *   │  │  client.ts → ws://localhost:<sidecar> │  │
 *   │  └───────────────────────────────────────┘  │
 *   │  ↑                                          │
 *   │  sidecar: `bun run @omni/server/src/bin.ts` │
 *   └─────────────────────────────────────────────┘
 *
 * Implementation TODO:
 *   1. Add Cargo.toml + src-tauri/ with `tauri::api::process::Command::new_sidecar`
 *   2. Bundle the Bun runtime (or use `@oven/bun` standalone) as a resource
 *   3. Compile @omni/web → static assets in src-tauri/dist/
 *   4. Wire window-level events: menu, tray, native notifications
 */
export const PLAN = "tauri-sidecar"
