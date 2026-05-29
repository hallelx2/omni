#!/usr/bin/env bun
/**
 * Publish a release: build all platform binaries and upload them as
 * GitHub release assets, named exactly as install.sh / install.ps1
 * expect (omni-<plat>-<arch>[.exe]).
 *
 *   bun run scripts/release.ts v0.1.0
 *   bun run scripts/release.ts v0.1.0 --draft
 *
 * Requires the `gh` CLI authenticated against the repo.
 */
import { resolve } from "node:path"
import { existsSync } from "node:fs"

const ROOT = resolve(import.meta.dir, "..")
const DIST = resolve(ROOT, "packages", "cli", "dist")

const tag = process.argv[2]
const draft = process.argv.includes("--draft")
if (!tag || !/^v\d+\.\d+\.\d+/.test(tag)) {
  console.error("usage: bun run scripts/release.ts v<major>.<minor>.<patch> [--draft]")
  process.exit(2)
}

const ASSETS = [
  "omni-windows-x64.exe",
  "omni-linux-x64",
  "omni-linux-arm64",
  // darwin-x64 (Intel Mac) dropped for v0.1.0 — no macos-13 runner available.
  "omni-darwin-arm64",
]

// ─── 1. Build all targets ────────────────────────────────────────────────────
console.log(`building all targets for ${tag}…`)
const build = Bun.spawn(["bun", "run", resolve(ROOT, "packages", "cli", "build.ts"), "all"], {
  stdout: "inherit",
  stderr: "inherit",
  cwd: ROOT,
})
if ((await build.exited) !== 0) {
  console.error("build failed")
  process.exit(1)
}

const present = ASSETS.map((a) => resolve(DIST, a)).filter((p) => existsSync(p))
if (present.length === 0) {
  console.error("no built assets found in", DIST)
  process.exit(1)
}
console.log(`built ${present.length}/${ASSETS.length} assets`)

// ─── 2. Create the GitHub release ────────────────────────────────────────────
const ghArgs = [
  "release",
  "create",
  tag,
  ...present,
  "--title",
  `Omni ${tag}`,
  "--generate-notes",
]
if (draft) ghArgs.push("--draft")

console.log(`creating GitHub release ${tag}…`)
const gh = Bun.spawn(["gh", ...ghArgs], { stdout: "inherit", stderr: "inherit", cwd: ROOT })
if ((await gh.exited) !== 0) {
  console.error("gh release create failed — is gh installed and authenticated?")
  process.exit(1)
}

console.log(`\ndone. install with:`)
console.log(`  macOS/Linux: curl -fsSL https://raw.githubusercontent.com/hallelx2/omni/main/install.sh | bash`)
console.log(`  Windows:     irm https://raw.githubusercontent.com/hallelx2/omni/main/install.ps1 | iex`)
