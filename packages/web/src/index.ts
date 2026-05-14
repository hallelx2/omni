/**
 * `@omni/web` — minimal browser client for the Omni server.
 *
 * Run the dev server with `bun run --cwd packages/web dev`. It serves
 * `index.html` plus a transpiled `client.ts` and proxies the WebSocket
 * to an embedded `@omni/server`.
 *
 * For a production deployment, run `@omni/server` separately and serve
 * `index.html` from any static host with `window.OMNI_WS_URL` injected.
 */
export {}
