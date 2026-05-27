import { useState } from "react"
import { FolderOpen, FolderSearch } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useApp } from "@/store/app"
import { isTauri, pickFolder } from "@/lib/tauri"

export function AddProjectDialog() {
  const open = useApp((s) => s.addProjectOpen)
  const setOpen = useApp((s) => s.setAddProjectOpen)
  const addProject = useApp((s) => s.addProject)
  const [path, setPath] = useState("")
  const [busy, setBusy] = useState(false)

  async function browse() {
    const picked = await pickFolder()
    if (picked) setPath(picked)
  }

  async function submit() {
    if (!path.trim()) return
    setBusy(true)
    const project = await addProject(path.trim())
    setBusy(false)
    if (project) {
      setPath("")
      setOpen(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-1 grid size-9 place-items-center rounded-lg bg-primary/12 text-primary">
            <FolderOpen className="size-4.5" />
          </div>
          <DialogTitle>Open a project</DialogTitle>
          <DialogDescription>
            Point Omni at a folder. Sessions, git, and files are scoped to it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            autoFocus
            placeholder={isTauri() ? "Choose or paste a folder path…" : "C:\\path\\to\\project"}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          {isTauri() && (
            <Button variant="outline" size="icon" onClick={browse} title="Browse">
              <FolderSearch className="size-4" />
            </Button>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!path.trim() || busy}>
            {busy ? "Opening…" : "Open project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
