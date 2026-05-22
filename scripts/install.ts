#!/usr/bin/env bun
/**
 * Local installer — builds Omni for the host platform, installs the
 * binary to ~/.omni/bin, and adds that directory to PATH.
 *
 *   bun run setup            # build + install + wire PATH
 *   bun run setup --no-path  # build + install, skip PATH wiring
 *
 * Idempotent: re-running upgrades the binary in place and never
 * duplicates PATH entries.
 */
import { resolve } from "node:path"
import { homedir } from "node:os"
import { mkdirSync, copyFileSync, existsSync, statSync, appendFileSync, readFileSync } from "node:fs"

const ROOT = resolve(import.meta.dir, "..")
const isWin = process.platform === "win32"
const binName = isWin ? "omni.exe" : "omni"
const installDir = resolve(homedir(), ".omni", "bin")
const installPath = resolve(installDir, binName)
const builtPath = resolve(ROOT, "packages", "cli", "dist", binName)
const skipPath = process.argv.includes("--no-path")

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}

console.log(c.bold("\n  ◆ omni installer\n"))

// ─── 1. Build ──────────────────────────────────────────────────────────────
console.log(c.dim("  building binary for this platform…"))
const build = Bun.spawn(["bun", "run", resolve(ROOT, "packages", "cli", "build.ts")], {
  stdout: "inherit",
  stderr: "inherit",
  cwd: ROOT,
})
const buildCode = await build.exited
if (buildCode !== 0) {
  console.error(c.yellow("\n  build failed — see output above"))
  process.exit(1)
}
if (!existsSync(builtPath)) {
  console.error(c.yellow(`\n  expected binary not found at ${builtPath}`))
  process.exit(1)
}

// ─── 2. Install ──────────────────────────────────────────────────────────────
mkdirSync(installDir, { recursive: true })
copyFileSync(builtPath, installPath)
const sizeMb = (statSync(installPath).size / 1024 / 1024).toFixed(0)
console.log(c.green(`  ✓ installed`) + c.dim(` → ${installPath} (${sizeMb}MB)`))

// ─── 3. PATH ──────────────────────────────────────────────────────────────
if (!skipPath) {
  if (isWin) await wireWindowsPath(installDir)
  else wireUnixPath(installDir)
}

// ─── 4. Done ────────────────────────────────────────────────────────────────
console.log(c.bold("\n  done.\n"))
console.log("  Run " + c.cyan("omni") + c.dim("  (open a new terminal first so PATH refreshes)"))
console.log("  Or:  " + c.cyan(`"${installPath}"`))
console.log()
console.log(c.dim("  Credentials: put MIMO_API_KEY in ~/.omni/.env (already set up if you ran from this repo)."))
console.log(c.dim("  Plain REPL:  omni --plain"))
console.log()

// ─── helpers ────────────────────────────────────────────────────────────────

async function wireWindowsPath(dir: string): Promise<void> {
  // Modify the *User* PATH (not Machine) via .NET, idempotently.
  const ps = [
    `$dir = ${psQuote(dir)}`,
    `$old = [Environment]::GetEnvironmentVariable('PATH','User')`,
    `if ($null -eq $old) { $old = '' }`,
    `$parts = $old.Split(';') | Where-Object { $_ -ne '' }`,
    `if ($parts -contains $dir) {`,
    `  Write-Output 'present'`,
    `} else {`,
    `  $next = (@($parts + $dir) -join ';')`,
    `  [Environment]::SetEnvironmentVariable('PATH', $next, 'User')`,
    `  Write-Output 'added'`,
    `}`,
  ].join("\n")
  const proc = Bun.spawn(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const out = (await new Response(proc.stdout).text()).trim()
  await proc.exited
  if (out === "added") {
    console.log(c.green("  ✓ PATH") + c.dim(` → added ${dir} to your User PATH`))
    console.log(c.dim("    (open a NEW terminal for it to take effect)"))
  } else {
    console.log(c.dim(`  · PATH already contains ${dir}`))
  }
}

function wireUnixPath(dir: string): void {
  const line = `export PATH="${dir}:$PATH"`
  const marker = "# omni installer"
  const block = `\n${marker}\n${line}\n`
  const shell = process.env.SHELL ?? ""
  const candidates: string[] = []
  if (shell.includes("zsh")) candidates.push(resolve(homedir(), ".zshrc"))
  else if (shell.includes("bash")) candidates.push(resolve(homedir(), ".bashrc"), resolve(homedir(), ".bash_profile"))
  else candidates.push(resolve(homedir(), ".profile"))

  for (const profile of candidates) {
    const existing = existsSync(profile) ? readFileSync(profile, "utf8") : ""
    if (existing.includes(marker) || existing.includes(line)) {
      console.log(c.dim(`  · PATH already wired in ${profile}`))
      return
    }
  }
  const profile = candidates[0]!
  appendFileSync(profile, block)
  console.log(c.green("  ✓ PATH") + c.dim(` → appended to ${profile}`))
  console.log(c.dim(`    run: source ${profile}  (or open a new terminal)`))
}

function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`
}
