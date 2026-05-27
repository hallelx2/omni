#!/usr/bin/env bun
/**
 * Sidecar entry for the Omni desktop app. Tauri spawns this binary, passing
 * `OMNI_DESKTOP_PORT` (0 = let the OS choose) and a random `OMNI_DESKTOP_TOKEN`.
 * On boot it prints a single JSON handshake line to stdout so the Tauri
 * supervisor learns the actual port:
 *
 *   {"type":"omni-ready","port":8137,"version":"0.1.0"}
 *
 * Build the standalone binary with `bun run packages/server/desktop-build.ts`.
 */
import { resolve } from "node:path"
import { omniHome } from "@omni/core"
import { loadDotenv } from "@omni/cli/env"
import { DesktopServer } from "./server.ts"

loadDotenv([resolve(process.cwd(), ".env"), resolve(omniHome(), ".env")])

const port = parseInt(process.env.OMNI_DESKTOP_PORT ?? "8137", 10)
const token = process.env.OMNI_DESKTOP_TOKEN || undefined

const server = new DesktopServer({ port, authToken: token })
const info = await server.start()

// Handshake — Tauri reads this from stdout. Keep it a single line.
process.stdout.write(
  JSON.stringify({ type: "omni-ready", port: info.port, hostname: info.hostname, version: "0.1.0" }) + "\n",
)

async function shutdown(): Promise<void> {
  await server.stop()
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
