/**
 * `@omni/vscode` — VS Code extension scaffold.
 *
 * Status: scaffold. The wiring plan:
 *   1. On activate(), spawn `@omni/server` as a child process bound to localhost
 *   2. Open a WebView panel hosting `@omni/web`'s client.ts
 *   3. Inject editor context: current file path, selection, workspace folder
 *   4. Expose commands:
 *        - omni.run     → focus input, send the current task
 *        - omni.sessions → list past sessions from .omni/db.sqlite
 *   5. Stream engine events into the WebView same as the web client
 *
 * The extension does NOT bundle the model SDKs itself — all heavy lifting
 * lives in @omni/server, which runs as a sidecar.
 */

// Note: we don't import "vscode" at the top level so the package typechecks
// without @types/vscode. When this is built for real, switch to:
//   import * as vscode from "vscode"
// and add @types/vscode as a devDependency.

export interface ExtensionAPI {
  readonly version: string
  readonly serverPort: number
}

const PLACEHOLDER: ExtensionAPI = { version: "0.0.0", serverPort: 0 }

export function activate(): ExtensionAPI {
  // eslint-disable-next-line no-console
  console.log("[omni] extension scaffold loaded (not a real activation yet)")
  return PLACEHOLDER
}

export function deactivate(): void {
  // no-op
}
