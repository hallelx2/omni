import { Plus, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SettingsSection, Field, Row } from "./field"
import type { OmniConfig, PermissionRuleConfig } from "@/lib/protocol"

const MODES = [
  { value: "ask", label: "Ask — prompt before each tool" },
  { value: "allow_all", label: "Allow all — never prompt" },
  { value: "rules", label: "Rules — match then ask" },
  { value: "deny_all", label: "Deny all — block everything" },
] as const

export function PermissionsPanel({
  draft,
  onChange,
}: {
  draft: OmniConfig
  onChange: (c: OmniConfig) => void
}) {
  const perms = draft.permissions ?? {}
  const setPerms = (patch: Partial<NonNullable<OmniConfig["permissions"]>>) =>
    onChange({ ...draft, permissions: { ...perms, ...patch } })

  const rules = perms.rules ?? []
  const setRules = (next: PermissionRuleConfig[]) => setPerms({ rules: next })
  const updateRule = (i: number, patch: Partial<PermissionRuleConfig>) =>
    setRules(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  return (
    <div className="space-y-6">
      <SettingsSection title="Permissions" description="How tool calls are gated. Safety guards (destructive bash) always apply on top.">
        <Field label="Mode">
          <Select value={perms.mode ?? "ask"} onValueChange={(v) => setPerms({ mode: v as never })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Row label="Deny destructive bash" hint="Block rm -rf /, fork bombs, curl | sh, etc.">
          <Switch
            checked={perms.denyDestructive ?? true}
            onCheckedChange={(v) => setPerms({ denyDestructive: v })}
          />
        </Row>
        <Row label="Confine to workspace" hint="Restrict file tools + bash to the project folder.">
          <Switch
            checked={perms.restrictToWorkspace ?? false}
            onCheckedChange={(v) => setPerms({ restrictToWorkspace: v })}
          />
        </Row>

        <Field label="Auto-allow tools" hint="Comma-separated tool names that never prompt (after safety guards).">
          <Input
            placeholder="read_file, glob, grep"
            value={(perms.autoAllow ?? []).join(", ")}
            onChange={(e) =>
              setPerms({
                autoAllow: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
      </SettingsSection>

      <SettingsSection
        title="Rules"
        description='Evaluated top-to-bottom when mode is "Rules". tool = exact name, "*", or /regex/. Optional "args contains" matches the stringified arguments.'
      >
        <div className="space-y-2">
          {rules.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              No rules yet. Unmatched calls fall through to a prompt.
            </p>
          )}
          {rules.map((rule, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-card/40 p-2">
              <Input
                className="h-8 flex-1 font-mono text-xs"
                placeholder="bash"
                value={rule.tool}
                onChange={(e) => updateRule(i, { tool: e.target.value })}
              />
              <Select value={rule.decision} onValueChange={(v) => updateRule(i, { decision: v as "allow" | "deny" })}>
                <SelectTrigger size="sm" className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow">Allow</SelectItem>
                  <SelectItem value="deny">Deny</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="h-8 flex-1 font-mono text-xs"
                placeholder="args contains… (optional)"
                value={rule.argsInclude ?? ""}
                onChange={(e) => updateRule(i, { argsInclude: e.target.value || undefined })}
              />
              <Button variant="ghost" size="icon-sm" onClick={() => setRules(rules.filter((_, idx) => idx !== i))}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRules([...rules, { tool: "", decision: "allow" }])}
          >
            <Plus className="size-4" /> Add rule
          </Button>
        </div>
      </SettingsSection>
    </div>
  )
}
