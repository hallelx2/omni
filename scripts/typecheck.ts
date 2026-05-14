#!/usr/bin/env bun
/**
 * Typecheck every workspace package. Exits non-zero on first failure.
 */
import { readdirSync, statSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = resolve(fileURLToPath(import.meta.url), "..")
const root = resolve(here, "..")
const packagesDir = resolve(root, "packages")

const packages = readdirSync(packagesDir)
  .map((name) => resolve(packagesDir, name))
  .filter((p) => statSync(p).isDirectory() && existsSync(resolve(p, "tsconfig.json")))

let failed = 0
for (const dir of packages) {
  const name = dir.slice(packagesDir.length + 1)
  process.stdout.write(`\x1b[2m[typecheck]\x1b[0m ${name.padEnd(14)} `)
  const proc = Bun.spawnSync(["bun", "x", "tsc", "--noEmit"], { cwd: dir })
  if (proc.exitCode === 0) {
    process.stdout.write("\x1b[32mok\x1b[0m\n")
  } else {
    failed++
    process.stdout.write("\x1b[31mfail\x1b[0m\n")
    process.stdout.write(proc.stderr.toString())
    process.stdout.write(proc.stdout.toString())
  }
}

if (failed > 0) {
  process.stderr.write(`\n\x1b[31m${failed} package(s) failed typecheck\x1b[0m\n`)
  process.exit(1)
}
process.stdout.write("\n\x1b[32mall packages typecheck\x1b[0m\n")
