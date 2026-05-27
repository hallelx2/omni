import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { SettingsSection, Field, Row } from "./field"
import type { OmniConfig } from "@/lib/protocol"

export function AdvancedPanel({
  draft,
  onChange,
}: {
  draft: OmniConfig
  onChange: (c: OmniConfig) => void
}) {
  const verifiers = draft.verifiers ?? {}
  const agents = draft.agents ?? {}

  const setVerifiers = (patch: Partial<NonNullable<OmniConfig["verifiers"]>>) =>
    onChange({ ...draft, verifiers: { ...verifiers, ...patch } })
  const setAgents = (patch: Partial<NonNullable<OmniConfig["agents"]>>) =>
    onChange({ ...draft, agents: { ...agents, ...patch } })

  return (
    <div className="space-y-6">
      <SettingsSection title="Verifiers" description="Run after tools to catch failures the model might miss.">
        <Row
          label="Disable built-in verifiers"
          hint="Turns off the cheap patch-applies / file-parses checks."
        >
          <Switch
            checked={verifiers.disableBuiltins ?? false}
            onCheckedChange={(v) => setVerifiers({ disableBuiltins: v })}
          />
        </Row>

        <div className="rounded-lg border border-border bg-card/40 p-3.5">
          <Row label="Typecheck after edits" hint="Runs tsc --noEmit (or your command).">
            <Switch
              checked={verifiers.typecheck?.enabled ?? false}
              onCheckedChange={(v) => setVerifiers({ typecheck: { ...verifiers.typecheck, enabled: v } })}
            />
          </Row>
          {verifiers.typecheck?.enabled && (
            <div className="mt-3">
              <Field label="Command">
                <Input
                  className="font-mono text-xs"
                  placeholder="tsc --noEmit"
                  value={verifiers.typecheck?.command ?? ""}
                  onChange={(e) =>
                    setVerifiers({ typecheck: { ...verifiers.typecheck, command: e.target.value || undefined } })
                  }
                />
              </Field>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card/40 p-3.5">
          <Row label="Tests after edits" hint="Runs your test command after file changes.">
            <Switch
              checked={verifiers.tests?.enabled ?? false}
              onCheckedChange={(v) => setVerifiers({ tests: { ...verifiers.tests, enabled: v } })}
            />
          </Row>
          {verifiers.tests?.enabled && (
            <div className="mt-3">
              <Field label="Command">
                <Input
                  className="font-mono text-xs"
                  placeholder="bun test"
                  value={verifiers.tests?.command ?? ""}
                  onChange={(e) =>
                    setVerifiers({ tests: { ...verifiers.tests, command: e.target.value || undefined } })
                  }
                />
              </Field>
            </div>
          )}
        </div>
      </SettingsSection>

      <SettingsSection title="Agents" description="Subagents and the parallel dispatch tool.">
        <Row label="Enable agents" hint="Master switch for subagents + dispatch_agents.">
          <Switch checked={agents.enabled ?? true} onCheckedChange={(v) => setAgents({ enabled: v })} />
        </Row>
        <Field label="Max concurrency" hint="Most children in one dispatch_agents call (1–8).">
          <Input
            type="number"
            min={1}
            max={8}
            className="w-28"
            placeholder="4"
            value={agents.maxConcurrency ?? ""}
            onChange={(e) => setAgents({ maxConcurrency: e.target.value ? Number(e.target.value) : undefined })}
          />
        </Field>
      </SettingsSection>
    </div>
  )
}
