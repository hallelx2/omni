/**
 * Git status + diff for a project folder, shelling out to the system `git`.
 * Degrades gracefully: a non-git folder returns `{ isRepo: false }`.
 */
import type { GitStatus, GitFile, GitDiff } from "./protocol.ts"

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(["git", "-C", cwd, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  })
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  const code = await proc.exited
  return { stdout, stderr, code }
}

async function isRepo(cwd: string): Promise<boolean> {
  try {
    const { stdout, code } = await git(cwd, ["rev-parse", "--is-inside-work-tree"])
    return code === 0 && stdout.trim() === "true"
  } catch {
    return false
  }
}

function parseBranchLine(line: string): { branch?: string; ahead?: number; behind?: number } {
  // "## main...origin/main [ahead 1, behind 2]" | "## main" | "## No commits yet on main"
  const body = line.replace(/^## /, "")
  if (body.startsWith("No commits yet on ")) {
    return { branch: body.replace("No commits yet on ", "").trim() }
  }
  const branch = body.split("...")[0]?.split(" ")[0]?.trim()
  const ahead = /ahead (\d+)/.exec(body)?.[1]
  const behind = /behind (\d+)/.exec(body)?.[1]
  return {
    branch: branch === "HEAD (no branch)" ? "(detached)" : branch,
    ahead: ahead ? Number(ahead) : undefined,
    behind: behind ? Number(behind) : undefined,
  }
}

export async function gitStatus(cwd: string): Promise<GitStatus> {
  if (!(await isRepo(cwd))) {
    return { isRepo: false, files: [], clean: true }
  }
  const { stdout } = await git(cwd, ["status", "--porcelain=v1", "-b", "--untracked-files=all"])
  const lines = stdout.split("\n").filter((l) => l.length > 0)
  let branchInfo: { branch?: string; ahead?: number; behind?: number } = {}
  const files: GitFile[] = []
  for (const line of lines) {
    if (line.startsWith("## ")) {
      branchInfo = parseBranchLine(line)
      continue
    }
    const x = line[0] ?? " "
    const y = line[1] ?? " "
    let path = line.slice(3)
    if (path.includes(" -> ")) path = path.split(" -> ")[1]! // rename → new name
    files.push({
      path: path.replace(/^"|"$/g, ""),
      status: `${x}${y}`,
      staged: x !== " " && x !== "?",
      unstaged: y !== " ",
      untracked: x === "?" && y === "?",
    })
  }
  return {
    isRepo: true,
    branch: branchInfo.branch,
    ahead: branchInfo.ahead,
    behind: branchInfo.behind,
    files,
    clean: files.length === 0,
  }
}

export async function gitDiff(cwd: string, path: string, staged: boolean): Promise<GitDiff> {
  const args = staged
    ? ["diff", "--staged", "--", path]
    : ["diff", "--", path]
  let { stdout } = await git(cwd, args)
  // Untracked files have no diff; synthesize one from the file contents.
  if (!stdout.trim() && !staged) {
    const { stdout: tracked } = await git(cwd, ["ls-files", "--error-unmatch", "--", path])
    if (!tracked.trim()) {
      const show = await git(cwd, ["diff", "--no-index", "--", "/dev/null", path])
      stdout = show.stdout
    }
  }
  return {
    path,
    diff: stdout,
    binary: /Binary files .* differ/.test(stdout),
  }
}
