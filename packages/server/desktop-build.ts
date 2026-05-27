#!/usr/bin/env bun
/**
 * Compile the desktop sidecar (`src/desktop/bin.ts`) into a standalone binary
 * and place it where Tauri's `externalBin` expects it, with the required
 * target-triple suffix:
 *
 *   packages/desktop/src-tauri/binaries/omni-desktop-server-<triple>[.exe]
 *
 *   bun run packages/server/desktop-build.ts          # host platform
 */
import { mkdirSync } from "node:fs"
import { resolve } from "node:path"

const HERE = import.meta.dir
const ENTRY = resolve(HERE, "src", "desktop", "bin.ts")
const OUTDIR = resolve(HERE, "..", "desktop", "src-tauri", "binaries")

const HOST: Record<string, { rust: string; bun: string; ext: string }> = {
  "win32-x64": { rust: "x86_64-pc-windows-msvc", bun: "bun-windows-x64", ext: ".exe" },
  "darwin-arm64": { rust: "aarch64-apple-darwin", bun: "bun-darwin-arm64", ext: "" },
  "darwin-x64": { rust: "x86_64-apple-darwin", bun: "bun-darwin-x64", ext: "" },
  "linux-x64": { rust: "x86_64-unknown-linux-gnu", bun: "bun-linux-x64", ext: "" },
  "linux-arm64": { rust: "aarch64-unknown-linux-gnu", bun: "bun-linux-arm64", ext: "" },
}

const key = `${process.platform}-${process.arch}`
const target = HOST[key]
if (!target) {
  console.error(`unsupported host: ${key}`)
  process.exit(1)
}

mkdirSync(OUTDIR, { recursive: true })
const outfile = resolve(OUTDIR, `omni-desktop-server-${target.rust}${target.ext}`)

const t0 = Date.now()
process.stdout.write(`building sidecar → binaries/omni-desktop-server-${target.rust}${target.ext} … `)
const result = await Bun.build({
  entrypoints: [ENTRY],
  target: "bun",
  compile: { target: target.bun as never, outfile },
  sourcemap: "none",
  minify: true,
})
if (!result.success) {
  process.stdout.write("FAILED\n")
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
process.stdout.write(`ok (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`)
console.log(`done → ${outfile}`)
