import { CheckCircle2, Circle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { SettingsSection } from "./field"
import { useApp } from "@/store/app"
import type { OmniConfig } from "@/lib/protocol"

type ProviderKey = "anthropic" | "openai" | "google" | "mimo" | "ollama"
const KEYED: ProviderKey[] = ["anthropic", "openai", "mimo", "google"]
const BASEURL: ProviderKey[] = ["anthropic", "openai", "mimo", "ollama"]

export function ProvidersPanel({
  draft,
  onChange,
}: {
  draft: OmniConfig
  onChange: (c: OmniConfig) => void
}) {
  const providers = useApp((s) => s.providers)

  function setProvider(id: ProviderKey, patch: { apiKey?: string; baseURL?: string }) {
    const providersCfg = { ...(draft.providers ?? {}) }
    const current = { ...(providersCfg[id] ?? {}), ...patch }
    // strip empty strings
    for (const k of Object.keys(current) as (keyof typeof current)[]) {
      if (current[k] === "") delete current[k]
    }
    providersCfg[id] = current
    onChange({ ...draft, providers: providersCfg })
  }

  return (
    <SettingsSection
      title="Providers"
      description="Keys are stored locally in your config file. Environment variables (e.g. ANTHROPIC_API_KEY) take precedence."
    >
      {providers
        .filter((p) => p.id !== "mock")
        .map((p) => {
          const id = p.id as ProviderKey
          const cfg = (draft.providers?.[id] ?? {}) as { apiKey?: string; baseURL?: string }
          return (
            <div key={p.id} className="rounded-lg border border-border bg-card/40 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{p.label}</span>
                  {p.hasKey ? (
                    <Badge variant="success">
                      <CheckCircle2 /> Ready
                    </Badge>
                  ) : p.needsKey ? (
                    <Badge variant="muted">
                      <Circle /> No key
                    </Badge>
                  ) : (
                    <Badge variant="success">
                      <CheckCircle2 /> Local
                    </Badge>
                  )}
                </div>
                <span className="font-mono text-[11px] text-muted-foreground">{p.models[0]}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {KEYED.includes(id) && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">API key {p.keyEnv ? `(${p.keyEnv})` : ""}</Label>
                    <Input
                      type="password"
                      placeholder="sk-…"
                      value={cfg.apiKey ?? ""}
                      onChange={(e) => setProvider(id, { apiKey: e.target.value })}
                    />
                  </div>
                )}
                {BASEURL.includes(id) && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Base URL</Label>
                    <Input
                      placeholder={id === "ollama" ? "http://localhost:11434/v1" : "Optional override"}
                      value={cfg.baseURL ?? ""}
                      onChange={(e) => setProvider(id, { baseURL: e.target.value })}
                    />
                  </div>
                )}
              </div>
            </div>
          )
        })}
    </SettingsSection>
  )
}
