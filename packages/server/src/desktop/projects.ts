/**
 * Project store — the list of folders the user has opened, persisted to
 * `~/.omni/desktop.json` (separate from the SQLite DB, which holds sessions).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { ulid } from "ulid"
import { omniHome } from "@omni/core"
import type { Project } from "./protocol.ts"

interface DesktopState {
  projects: Project[]
}

function statePath(): string {
  return resolve(omniHome(), "desktop.json")
}

export class ProjectStore {
  private state: DesktopState = { projects: [] }

  constructor(private readonly path: string = statePath()) {
    this.load()
  }

  private load(): void {
    if (!existsSync(this.path)) return
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<DesktopState>
      if (Array.isArray(parsed.projects)) this.state.projects = parsed.projects
    } catch {
      // Corrupt file → start fresh rather than crash the server.
      this.state = { projects: [] }
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(this.state, null, 2) + "\n", "utf8")
  }

  list(): readonly Project[] {
    return [...this.state.projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
  }

  get(id: string): Project | undefined {
    return this.state.projects.find((p) => p.id === id)
  }

  /** Add (or re-surface) a project folder. Throws if the path isn't a directory. */
  add(rawPath: string): Project {
    const path = resolve(rawPath)
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      throw new Error(`not a directory: ${path}`)
    }
    const existing = this.state.projects.find((p) => p.path === path)
    if (existing) {
      const touched = { ...existing, lastOpenedAt: Date.now() }
      this.state.projects = this.state.projects.map((p) => (p.id === existing.id ? touched : p))
      this.persist()
      return touched
    }
    const now = Date.now()
    const project: Project = {
      id: ulid(),
      path,
      name: basename(path) || path,
      addedAt: now,
      lastOpenedAt: now,
    }
    this.state.projects.push(project)
    this.persist()
    return project
  }

  update(id: string, patch: Partial<Pick<Project, "name" | "modelRef" | "mode" | "lastOpenedAt">>): Project | undefined {
    const idx = this.state.projects.findIndex((p) => p.id === id)
    if (idx < 0) return undefined
    const updated = { ...this.state.projects[idx]!, ...patch }
    this.state.projects[idx] = updated
    this.persist()
    return updated
  }

  touch(id: string): void {
    this.update(id, { lastOpenedAt: Date.now() })
  }

  remove(id: string): boolean {
    const before = this.state.projects.length
    this.state.projects = this.state.projects.filter((p) => p.id !== id)
    if (this.state.projects.length === before) return false
    this.persist()
    return true
  }
}
