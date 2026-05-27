import { useState } from "react"
import { Plus, Trash2, Boxes } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SettingsSection } from "./field"
import type { OmniConfig } from "@/lib/protocol"

type Server = NonNullable<NonNullable<OmniConfig["mcp"]>["servers"]>[string]

export function McpPanel({
  draft,
  onChange,
}: {
  draft: OmniConfig
  onChange: (c: OmniConfig) => void
}) {
  const servers = draft.mcp?.servers ?? {}
  const [name, setName] = useState("")
  const [kind, setKind] = useState<"stdio" | "http">("stdio")
  const [target, setTarget] = useState("")

  function setServers(next: Record<string, Server>) {
    onChange({ ...draft, mcp: { ...draft.mcp, servers: next } })
  }

  function add() {
    const key = name.trim()
    if (!key || !target.trim()) return
    const server: Server =
      kind === "stdio"
        ? { kind: "stdio", command: target.trim(), permission: "ask" }
        : { kind: "http", url: target.trim(), permission: "ask" }
    setServers({ ...servers, [key]: server })
    setName("")
    setTarget("")
  }

  function remove(key: string) {
    const next = { ...servers }
    delete next[key]
    setServers(next)
  }

  const entries = Object.entries(servers)

  return (
    <SettingsSection
      title="MCP servers"
      description="Model Context Protocol servers add extra tools. Their tools are gated by the per-server permission."
    >
      <div className="space-y-2">
        {entries.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-3 py-8 text-center text-muted-foreground">
            <Boxes className="size-6" />
            <p className="text-xs">No MCP servers configured.</p>
          </div>
        )}
        {entries.map(([key, server]) => (
          <div key={key} className="flex items-center gap-2 rounded-lg border border-border bg-card/40 px-3 py-2.5">
            <Badge variant="secondary">{server.kind}</Badge>
            <span className="shrink-0 text-sm font-medium">{key}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
              {server.kind === "stdio" ? server.command : server.url}
            </span>
            <Button variant="ghost" size="icon-sm" onClick={() => remove(key)}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card/40 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Add server</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="h-8 w-32"
            placeholder="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Select value={kind} onValueChange={(v) => setKind(v as "stdio" | "http")}>
            <SelectTrigger size="sm" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stdio">stdio</SelectItem>
              <SelectItem value="http">http</SelectItem>
            </SelectContent>
          </Select>
          <Input
            className="h-8 min-w-48 flex-1 font-mono text-xs"
            placeholder={kind === "stdio" ? "command (e.g. npx -y server)" : "https://…"}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <Button size="sm" onClick={add} disabled={!name.trim() || !target.trim()}>
            <Plus className="size-4" /> Add
          </Button>
        </div>
      </div>
    </SettingsSection>
  )
}
