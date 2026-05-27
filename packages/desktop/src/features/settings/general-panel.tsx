import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ModelPicker } from "@/components/model-picker"
import { SettingsSection, Field, Row } from "./field"
import type { OmniConfig } from "@/lib/protocol"

export function GeneralPanel({
  draft,
  onChange,
}: {
  draft: OmniConfig
  onChange: (c: OmniConfig) => void
}) {
  const set = (patch: Partial<OmniConfig>) => onChange({ ...draft, ...patch })
  const modelRef = draft.adapter && draft.model ? `${draft.adapter}:${draft.model}` : undefined

  return (
    <SettingsSection title="General" description="Defaults applied to every project that doesn't override them.">
      <Field label="Default model" hint="Used when a project hasn't set its own model.">
        <ModelPicker
          size="default"
          value={modelRef}
          onChange={(ref) => {
            if (!ref) return set({ adapter: undefined, model: undefined })
            const [adapter, ...rest] = ref.split(":")
            set({ adapter: adapter as OmniConfig["adapter"], model: rest.join(":") })
          }}
        />
      </Field>

      <Field label="System prompt" hint="Leave empty to use Omni's built-in agent prompt.">
        <Textarea
          rows={5}
          placeholder="Optional — overrides the built-in system prompt entirely."
          value={draft.systemPrompt ?? ""}
          onChange={(e) => set({ systemPrompt: e.target.value || undefined })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Max iterations" hint="Tool/model loop ceiling per run.">
          <Input
            type="number"
            min={1}
            value={draft.maxIterations ?? ""}
            placeholder="12"
            onChange={(e) => set({ maxIterations: e.target.value ? Number(e.target.value) : undefined })}
          />
        </Field>
        <Field label="Default mode" hint="Plan is read-only; build has full tools.">
          <Select
            value={draft.modes?.default ?? "build"}
            onValueChange={(v) => set({ modes: { ...draft.modes, default: v as "plan" | "build" } })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="build">Build</SelectItem>
              <SelectItem value="plan">Plan</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Row label="ReAct fallback" hint="Parse Action:/Action Input: when the model has no native tool calls.">
        <Switch
          checked={draft.enableReActFallback ?? true}
          onCheckedChange={(v) => set({ enableReActFallback: v })}
        />
      </Row>
    </SettingsSection>
  )
}
