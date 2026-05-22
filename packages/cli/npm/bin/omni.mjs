#!/usr/bin/env node
/**
 * Launcher shim for the `omni` command. Resolves the prebuilt binary from
 * the platform-specific optional dependency that npm installed for this
 * machine, then execs it with the user's args and inherited stdio.
 *
 * This is the esbuild / biome / opencode pattern: the main package is
 * tiny + pure JS; the heavy platform binary lives in an optionalDependency
 * gated by `os` / `cpu` so npm only downloads the one you need.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

const OS_LABEL = { win32: "windows", darwin: "darwin", linux: "linux" }
const PKG_BASE = "omni-harness" // keep in sync with scripts/npm-release.ts NAME

const osLabel = OS_LABEL[process.platform]
const arch = process.arch // "x64" | "arm64"

if (!osLabel || (arch !== "x64" && arch !== "arm64")) {
  console.error(`omni: unsupported platform ${process.platform}/${process.arch}`)
  process.exit(1)
}

const pkg = `${PKG_BASE}-${osLabel}-${arch}`
const binName = process.platform === "win32" ? "omni.exe" : "omni"

let binPath
try {
  binPath = require.resolve(`${pkg}/${binName}`)
} catch {
  console.error(
    `omni: the platform binary package "${pkg}" is not installed.\n` +
      `This usually means the optional dependency failed to install.\n` +
      `Try reinstalling: npm install -g ${PKG_BASE}\n` +
      `Or grab a binary directly from https://github.com/hallelx2/omni/releases`,
  )
  process.exit(1)
}

const result = spawnSync(binPath, process.argv.slice(2), { stdio: "inherit" })
if (result.error) {
  console.error(`omni: failed to launch binary: ${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 0)
