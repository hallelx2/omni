# @omni/desktop

A small, fast, beautiful **Tauri 2 + React** desktop app for the Omni agent harness.
Multi-project, multi-session, with live streaming runs, per-project LLM config, a
permission-rules editor, and built-in git + file explorers.

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Tauri window  (Rust shell · src-tauri/)                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  WebView2  ←  React + Vite + Tailwind/shadcn (src/)   │  │
│  │      │  REST  /api/*      ws  /ws  (multiplexed)       │  │
│  └──────┼───────────────────────────────────────────────┘  │
│         ▼                                                    │
│  Bun sidecar  (externalBin)  ──  @omni/server DesktopServer │
│      Engine · SQLite sessions · config · git · files        │
└────────────────────────────────────────────────────────────┘
```

- **Frontend** (`src/`): React 19, Vite 6, Tailwind v4, shadcn-style primitives,
  zustand store, single multiplexed WebSocket for live engine events.
- **Shell** (`src-tauri/`): thin Rust layer. On launch it spawns the Bun sidecar
  (OS-assigned port), reads the `omni-ready` handshake from stdout, and exposes the
  port to the webview via the `server_info` command. Native folder picker + window
  controls (custom title bar).
- **Backend**: `@omni/server`'s `DesktopServer` (in `packages/server/src/desktop/`)
  builds one `Engine` per session with the project's `cwd`, persists sessions to the
  shared `~/.omni/db.sqlite`, reads/writes `~/.omni/config.json`, and serves git +
  file-tree endpoints.

## Prerequisites

- **Bun** ≥ 1.2, **Rust** (stable) + Cargo, and on Windows **WebView2** (ships with
  Windows 11).

## Develop

```bash
# from packages/desktop
bun run sidecar      # compile the Bun sidecar → src-tauri/binaries/
bun run tauri:dev    # starts Vite (:1420), compiles the Rust shell, opens the app
```

Run the frontend alone against a standalone sidecar (no Tauri):

```bash
bun run --cwd ../server desktop            # sidecar on :8137
bun run dev                                # Vite on :1420 (talks to :8137)
```

## Build

```bash
bun run sidecar      # ensure the sidecar binary exists for the target triple
bun run tauri:build  # produces installers in src-tauri/target/release/bundle/
```

## Layout

```
src/
  lib/          api (REST), ws (socket), protocol (wire types), tauri bridge
  store/        zustand app store + chat timeline folding
  components/   title bar, project rail, session sidebar, status bar, palette, ui/
  features/     chat/, settings/, git/, files/
src-tauri/      Rust shell, tauri.conf.json, capabilities, icons, binaries/
```
