/**
 * `@omni/server` — HTTP + WebSocket server that exposes a streaming engine
 * over the network. Consumed by the web, desktop, and VS Code surfaces.
 *
 * @example
 * ```ts
 * import { OmniServer } from "@omni/server"
 * import { Engine, AllowAllPermissions } from "@omni/core"
 * import { MockAdapter } from "@omni/adapters"
 *
 * const server = new OmniServer({
 *   port: 8000,
 *   engineConfig: () => ({
 *     model: new MockAdapter({ script: [] }),
 *     tools: [],
 *     permissions: new AllowAllPermissions(),
 *   }),
 * })
 * server.start()
 * ```
 */
export { OmniServer } from "./server.ts"
export type { OmniServerOptions } from "./server.ts"
