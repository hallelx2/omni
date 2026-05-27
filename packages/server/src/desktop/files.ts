/**
 * File-tree browsing + single-file reads for a project, with path confinement
 * to the project root. Lazy: returns one directory level at a time.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve, relative, sep, extname } from "node:path"
import type { FileTree, FileEntry, FileContent } from "./protocol.ts"

const IGNORED = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  ".DS_Store",
  "target",
  ".venv",
  "__pycache__",
])

const MAX_READ_BYTES = 512 * 1024

const LANG_BY_EXT: Record<string, string> = {
  ".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "jsx",
  ".json": "json", ".md": "markdown", ".mdx": "markdown", ".css": "css",
  ".scss": "scss", ".html": "html", ".rs": "rust", ".go": "go", ".py": "python",
  ".rb": "ruby", ".java": "java", ".c": "c", ".h": "c", ".cpp": "cpp",
  ".sh": "bash", ".bash": "bash", ".zsh": "bash", ".ps1": "powershell",
  ".toml": "toml", ".yaml": "yaml", ".yml": "yaml", ".sql": "sql",
  ".swift": "swift", ".kt": "kotlin", ".php": "php", ".lua": "lua",
  ".vue": "vue", ".svelte": "svelte", ".xml": "xml", ".dockerfile": "dockerfile",
}

function toPosix(p: string): string {
  return p.split(sep).join("/")
}

/** Resolve a relative path inside `root`, rejecting traversal outside it. */
function safeResolve(root: string, rel: string): string {
  const abs = resolve(root, rel)
  const r = relative(root, abs)
  if (r.startsWith("..") || (r.length > 0 && resolve(root, r) !== abs)) {
    throw new Error("path escapes project root")
  }
  return abs
}

export function fileTree(root: string, dir = ""): FileTree {
  const abs = safeResolve(root, dir)
  const dirents = readdirSync(abs, { withFileTypes: true })
  const entries: FileEntry[] = []
  for (const d of dirents) {
    if (IGNORED.has(d.name)) continue
    if (d.name.startsWith(".") && d.name !== ".env.example" && d.name !== ".gitignore") {
      // hide most dotfiles but keep a couple of useful ones
      if (![".github", ".vscode", ".omni"].includes(d.name)) continue
    }
    const rel = toPosix(join(dir, d.name))
    entries.push({ name: d.name, path: rel, type: d.isDirectory() ? "dir" : "file" })
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return { dir: toPosix(dir), entries }
}

export function readProjectFile(root: string, path: string): FileContent {
  const abs = safeResolve(root, path)
  const st = statSync(abs)
  const language = LANG_BY_EXT[extname(abs).toLowerCase()] ?? "plaintext"
  if (st.size > MAX_READ_BYTES) {
    const buf = readFileSync(abs).subarray(0, MAX_READ_BYTES)
    return {
      path: toPosix(path),
      content: decode(buf),
      truncated: true,
      tooLarge: true,
      binary: isBinary(buf),
      language,
      bytes: st.size,
    }
  }
  const buf = readFileSync(abs)
  const binary = isBinary(buf)
  return {
    path: toPosix(path),
    content: binary ? "" : decode(buf),
    truncated: false,
    tooLarge: false,
    binary,
    language,
    bytes: st.size,
  }
}

function decode(buf: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(buf)
}

function isBinary(buf: Uint8Array): boolean {
  const len = Math.min(buf.length, 8000)
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true
  return false
}
