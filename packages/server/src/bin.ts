#!/usr/bin/env bun
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { AllowAllPermissions, type EngineConfig } from "@omni/core"
import { mimo, MockAdapter, type MockScript } from "@omni/adapters"
import { bash, readFile, edit, glob, grep, webFetch } from "@omni/tools"
import { loadDotenv } from "@omni/cli/env"
import { OmniServer } from "./server.ts"

const __filename = fileURLToPath(import.meta.url)
loadDotenv([resolve(dirname(__filename), "..", "..", "..", ".env")])

const port = parseInt(process.env.OMNI_SERVER_PORT ?? "8088", 10)
const authToken = process.env.OMNI_SERVER_TOKEN

function makeConfig(): EngineConfig {
  if (process.env.MIMO_API_KEY) {
    return {
      model: mimo({
        apiKey: process.env.MIMO_API_KEY,
        model: process.env.OMNI_MODEL ?? "mimo-v2.5-pro",
        baseURL: process.env.MIMO_BASE_URL,
      }),
      tools: [bash, readFile, edit, glob, grep, webFetch],
      permissions: new AllowAllPermissions(),
      maxIterations: 12,
    }
  }
  // Fallback: deterministic mock so the server is always runnable.
  const script: MockScript[] = [{ kind: "text", text: "Mock adapter — set MIMO_API_KEY for real model." }]
  return {
    model: new MockAdapter({ script }),
    tools: [],
    permissions: new AllowAllPermissions(),
  }
}

const server = new OmniServer({ port, engineConfig: makeConfig, authToken })
const info = server.start()
// eslint-disable-next-line no-console
console.log(`Omni server listening on http://${info.hostname}:${info.port}`)
process.on("SIGINT", () => {
  server.stop()
  process.exit(0)
})
