#!/usr/bin/env bun
/**
 * Dev server: serves the web client AND embeds the Omni server on the same port.
 * Run with `bun run dev` in this package. Uses Bun's `routes` feature for
 * static assets and a fetch fallback for WebSocket upgrades.
 */
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { AllowAllPermissions, type EngineConfig } from "@omni/core"
import { MockAdapter, type MockScript } from "@omni/adapters"
import { OmniServer } from "@omni/server"

const __filename = fileURLToPath(import.meta.url)
const here = dirname(__filename)

const script: MockScript[] = [
  { kind: "text", text: "(mock) configure MIMO_API_KEY for a real model" },
]

// Embed Omni server WS at /ws and serve the page at /.
const cfg = (): EngineConfig => ({
  model: new MockAdapter({ script }),
  tools: [],
  permissions: new AllowAllPermissions(),
})

// Run engine server on its own port, then a static-only Bun.serve points the
// client at it. Keeps responsibilities clean.
const engineServer = new OmniServer({ port: 0, engineConfig: cfg })
const info = engineServer.start()

Bun.serve({
  port: parseInt(process.env.OMNI_WEB_PORT ?? "3000", 10),
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await Bun.file(resolve(here, "index.html")).text()
      const injected = html.replace(
        "<head>",
        `<head>\n  <script>window.OMNI_WS_URL = "ws://${info.hostname}:${info.port}/ws";</script>`,
      )
      return new Response(injected, { headers: { "Content-Type": "text/html" } })
    }
    if (url.pathname === "/client.ts") {
      const ts = await Bun.file(resolve(here, "client.ts")).text()
      // Bun can transpile TS to JS on the fly via Bun.Transpiler.
      const js = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(ts)
      return new Response(js, { headers: { "Content-Type": "application/javascript" } })
    }
    return new Response("not found", { status: 404 })
  },
})

// eslint-disable-next-line no-console
console.log(`Omni web dev: http://localhost:${process.env.OMNI_WEB_PORT ?? 3000}`)
// eslint-disable-next-line no-console
console.log(`Engine WS:    ws://${info.hostname}:${info.port}/ws`)
