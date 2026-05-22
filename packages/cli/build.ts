#!/usr/bin/env bun
/**
 * Compile Omni into a single self-contained executable.
 *
 *   bun packages/cli/build.ts                 # host platform
 *   bun packages/cli/build.ts bun-windows-x64 # explicit target
 *   bun packages/cli/build.ts all             # all common targets
 *
 * Output lands in packages/cli/dist/. The opentui Solid JSX is
 * transformed at build time by the bun-plugin (replacing the dev-time
 * preload), so the binary needs no runtime preload.
 *
 * Targets Bun supports: bun-windows-x64, bun-linux-x64, bun-linux-arm64,
 * bun-darwin-x64, bun-darwin-arm64.
 */
import solidPlugin from "@opentui/solid/bun-plugin"
import { resolve } from "node:path"

const HERE = import.meta.dir
const ENTRY = resolve(HERE, "src", "bin.ts")
const OUTDIR = resolve(HERE, "dist")

const HOST = `bun-${process.platform === "win32" ? "windows" : process.platform}-${process.arch === "arm64" ? "arm64" : "x64"}`

const ALL_TARGETS = [
  "bun-windows-x64",
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-darwin-x64",
  "bun-darwin-arm64",
] as const

function outfileFor(target: string): string {
  const base = target.includes("windows") ? "omni.exe" : "omni"
  // When building a single host target, emit plain `omni`/`omni.exe`.
  // For multi-target builds, suffix with the platform so they don't clash.
  return resolve(OUTDIR, base)
}

function outfileForMulti(target: string): string {
  const suffix = target.replace("bun-", "")
  const ext = target.includes("windows") ? ".exe" : ""
  return resolve(OUTDIR, `omni-${suffix}${ext}`)
}

async function build(target: string, outfile: string): Promise<void> {
  const t0 = Date.now()
  process.stdout.write(`building ${target} → ${outfile.replace(HERE, ".")} … `)
  const result = await Bun.build({
    entrypoints: [ENTRY],
    target: "bun",
    plugins: [solidPlugin],
    compile: { target: target as never, outfile },
    // Keep the binary lean-ish; sourcemaps off for release.
    sourcemap: "none",
    minify: false,
  })
  if (!result.success) {
    process.stdout.write("FAILED\n")
    for (const log of result.logs) console.error(log)
    throw new Error(`build failed for ${target}`)
  }
  process.stdout.write(`ok (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`)
}

const arg = process.argv[2]

if (arg === "all") {
  // opentui ships per-platform NATIVE modules (@opentui/core-<os>-<arch>)
  // that are only installed for the host. Cross-compiling to another OS
  // from one machine therefore can't resolve the target's native package
  // and fails. We continue past those so the host target still builds;
  // full cross-platform release is done on a CI matrix (one runner per OS).
  const failed: string[] = []
  for (const t of ALL_TARGETS) {
    try {
      await build(t, outfileForMulti(t))
    } catch {
      failed.push(t)
      console.log(`  ${t}: skipped (native module for this target not installed — build on a ${t} runner)`)
    }
  }
  if (failed.length === ALL_TARGETS.length) {
    console.error("all targets failed")
    process.exit(1)
  }
  if (failed.length > 0) {
    console.log(`\nbuilt ${ALL_TARGETS.length - failed.length}/${ALL_TARGETS.length}. Skipped: ${failed.join(", ")}`)
    console.log("Full cross-platform binaries are produced by the CI release matrix.")
  }
} else {
  const target = arg ?? HOST
  await build(target, outfileFor(target))
}

console.log("done. binaries in packages/cli/dist/")
