import { useEffect, useState } from "react"
import { SlidersHorizontal, KeyRound, ShieldCheck, Boxes, Cpu } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { useApp } from "@/store/app"
import type { OmniConfig } from "@/lib/protocol"
import { GeneralPanel } from "./general-panel"
import { ProvidersPanel } from "./providers-panel"
import { PermissionsPanel } from "./permissions-panel"
import { McpPanel } from "./mcp-panel"
import { AdvancedPanel } from "./advanced-panel"

export function SettingsDialog() {
  const open = useApp((s) => s.settingsOpen)
  const setOpen = useApp((s) => s.setSettingsOpen)
  const config = useApp((s) => s.config)
  const saveConfig = useApp((s) => s.saveConfig)
  const paths = useApp((s) => s.paths)

  const [draft, setDraft] = useState<OmniConfig>(config)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setDraft(structuredClone(config))
  }, [open, config])

  async function save() {
    setSaving(true)
    const ok = await saveConfig(draft)
    setSaving(false)
    if (ok) setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex h-[78vh] max-h-[680px] max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Stored in{" "}
            <span className="font-mono text-xs">{paths?.config ?? "~/.omni/config.json"}</span>
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="flex min-h-0 flex-1 flex-col">
          <div className="px-6 pt-4">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="general">
                <SlidersHorizontal /> General
              </TabsTrigger>
              <TabsTrigger value="providers">
                <KeyRound /> Providers
              </TabsTrigger>
              <TabsTrigger value="permissions">
                <ShieldCheck /> Permissions
              </TabsTrigger>
              <TabsTrigger value="mcp">
                <Boxes /> MCP
              </TabsTrigger>
              <TabsTrigger value="advanced">
                <Cpu /> Advanced
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
            <TabsContent value="general">
              <GeneralPanel draft={draft} onChange={setDraft} />
            </TabsContent>
            <TabsContent value="providers">
              <ProvidersPanel draft={draft} onChange={setDraft} />
            </TabsContent>
            <TabsContent value="permissions">
              <PermissionsPanel draft={draft} onChange={setDraft} />
            </TabsContent>
            <TabsContent value="mcp">
              <McpPanel draft={draft} onChange={setDraft} />
            </TabsContent>
            <TabsContent value="advanced">
              <AdvancedPanel draft={draft} onChange={setDraft} />
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter className="border-t border-border px-6 py-3.5">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
