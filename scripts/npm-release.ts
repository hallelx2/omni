#!/usr/bin/env bun
/**
 * Build the npm distribution: one tiny pure-JS launcher package plus a
 * per-platform binary package for each target (the esbuild / opencode
 * pattern). Then optionally publish them all under a dist-tag.
 *
 *   bun run scripts/npm-release.ts 0.1.0-beta.1 --pack-only   # stage, no publish
 *   bun run scripts/npm-release.ts 0.1.0-beta.1 --dry-run     # publish --dry-run
 *   bun run scripts/npm-release.ts 0.1.0-beta.1 --tag beta    # real publish, beta tag
 *   bun run scripts/npm-release.ts 0.1.0         --tag latest # real publish, latest
 *
 * Staging is written to packages/cli/dist-npm/. Requires `bun run
 * build:all` to have produced binaries in packages/cli/dist/ — this
 * script runs it for you unless --no-build is passed.
 */
import { resolve } from "node:path"
import { mkdirSync, copyFileSync, writeFileSync, rmSync, existsSync, cpSync } from "node:fs"

// ── Change NAME here to switch to a scoped package, e.g. "@hallelx2/omni".
//    Keep PKG_BASE in packages/cli/npm/bin/omni.mjs in sync.
const NAME = "omni-harness"
const REPO = "hallelx2/omni"
const DESCRIPTION = "A self-improving agent harness for open models (MiMo, Qwen, GLM, Kimi)."

const ROOT = resolve(import.meta.dir, "..")
const DIST = resolve(ROOT, "packages", "cli", "dist")
const STAGE = resolve(ROOT, "packages", "cli", "dist-npm")
const SHIM = resolve(ROOT, "packages", "cli", "npm", "bin", "omni.mjs")

const version = process.argv[2]
const packOnly = process.argv.includes("--pack-only")
const dryRun = process.argv.includes("--dry-run")
const noBuild = process.argv.includes("--no-build")
const tagIdx = process.argv.indexOf("--tag")
const tag = tagIdx >= 0 ? process.argv[tagIdx + 1] : "beta"

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error("usage: bun run scripts/npm-release.ts <version> [--pack-only|--dry-run|--tag <tag>] [--no-build]")
  console.error("  e.g. bun run scripts/npm-release.ts 0.1.0-beta.1 --tag beta")
  process.exit(2)
}

// platform key → { binary built by build:all, npm os, npm cpu, installed bin name }
const TARGETS = [
  { key: "windows-x64",  built: "omni-windows-x64.exe", os: "win32",  cpu: "x64",   bin: "omni.exe" },
  { key: "linux-x64",    built: "omni-linux-x64",       os: "linux",  cpu: "x64",   bin: "omni" },
  { key: "linux-arm64",  built: "omni-linux-arm64",     os: "linux",  cpu: "arm64", bin: "omni" },
  // darwin-x64 (Intel Mac) dropped for v0.1.0 — GitHub's macos-13 runner is
  // unavailable (retiring) so the leg can't build; re-add in a later release.
  { key: "darwin-arm64", built: "omni-darwin-arm64",    os: "darwin", cpu: "arm64", bin: "omni" },
] as const

// ── 1. Build all platform binaries ──────────────────────────────────────────
if (!noBuild) {
  console.log("building all platform binaries…")
  const b = Bun.spawn(["bun", "run", resolve(ROOT, "packages", "cli", "build.ts"), "all"], {
    stdout: "inherit",
    stderr: "inherit",
    cwd: ROOT,
  })
  if ((await b.exited) !== 0) {
    console.error("build failed")
    process.exit(1)
  }
}

// ── 2. Stage packages ───────────────────────────────────────────────────────
rmSync(STAGE, { recursive: true, force: true })
mkdirSync(STAGE, { recursive: true })

const platformPkgNames: string[] = []
const optionalDeps: Record<string, string> = {}
const stagedPlatformDirs: string[] = []

for (const t of TARGETS) {
  const builtPath = resolve(DIST, t.built)
  if (!existsSync(builtPath)) {
    console.warn(`skip ${t.key}: ${t.built} not found (build it or drop --no-build)`)
    continue
  }
  const pkgName = `${NAME}-${t.key}`
  const dir = resolve(STAGE, pkgName.replace("/", "-"))
  mkdirSync(dir, { recursive: true })
  copyFileSync(builtPath, resolve(dir, t.bin))
  const pkgJson = {
    name: pkgName,
    version,
    description: `${DESCRIPTION} (${t.key} binary)`,
    repository: { type: "git", url: `git+https://github.com/${REPO}.git` },
    license: "MIT",
    os: [t.os],
    cpu: [t.cpu],
    files: [t.bin],
  }
  writeFileSync(resolve(dir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n")
  platformPkgNames.push(pkgName)
  optionalDeps[pkgName] = version
  stagedPlatformDirs.push(dir)
  console.log(`staged ${pkgName}`)
}

if (platformPkgNames.length === 0) {
  console.error("no platform binaries staged — run `bun run build:all` first")
  process.exit(1)
}

// ── 3. Stage the main launcher package ──────────────────────────────────────
const mainDir = resolve(STAGE, NAME.replace("/", "-"))
mkdirSync(resolve(mainDir, "bin"), { recursive: true })
copyFileSync(SHIM, resolve(mainDir, "bin", "omni.mjs"))
const mainPkg = {
  name: NAME,
  version,
  description: DESCRIPTION,
  repository: { type: "git", url: `git+https://github.com/${REPO}.git` },
  homepage: `https://github.com/${REPO}`,
  license: "MIT",
  type: "module",
  bin: { omni: "bin/omni.mjs" },
  files: ["bin"],
  optionalDependencies: optionalDeps,
  keywords: ["ai", "agent", "harness", "llm", "cli", "mimo", "qwen", "glm", "kimi", "tui"],
  engines: { node: ">=18" },
}
writeFileSync(resolve(mainDir, "package.json"), JSON.stringify(mainPkg, null, 2) + "\n")
// Ship the README with the main package so npm shows it.
const readme = resolve(ROOT, "README.md")
if (existsSync(readme)) cpSync(readme, resolve(mainDir, "README.md"))
console.log(`staged ${NAME} (launcher) with ${platformPkgNames.length} optional deps`)

console.log(`\nstaged at ${STAGE.replace(ROOT, ".")}`)

if (packOnly) {
  console.log("\n--pack-only: nothing published. Inspect with:")
  console.log(`  cd ${resolve(STAGE, NAME).replace(ROOT, ".")} && npm pack --dry-run`)
  process.exit(0)
}

// ── 4. Publish (platform packages first, launcher last) ──────────────────────
const publishArgs = ["publish", "--access", "public", "--tag", tag]
if (dryRun) publishArgs.push("--dry-run")

async function publish(dir: string): Promise<void> {
  const p = Bun.spawn(["npm", ...publishArgs], { cwd: dir, stdout: "inherit", stderr: "inherit" })
  if ((await p.exited) !== 0) throw new Error(`publish failed in ${dir}`)
}

console.log(`\npublishing ${dryRun ? "(dry-run) " : ""}under tag "${tag}"…\n`)
try {
  for (const dir of stagedPlatformDirs) await publish(dir)
  await publish(mainDir) // launcher last so optionalDependencies already exist
} catch (e) {
  console.error((e as Error).message)
  console.error("\nIf this is an auth error, run `npm login` first.")
  process.exit(1)
}

console.log(`\ndone. install with:`)
console.log(`  npm i -g ${NAME}${tag !== "latest" ? `@${tag}` : ""}`)
console.log(`  then run:  omni`)
