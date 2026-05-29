import Link from "next/link";
import { TokenStream } from "./token-stream";

const FEATURES = [
  {
    eyebrow: "third brain",
    title: "Planner · Critic · Memory",
    body: "A planner decomposes the task, a critic reviews every turn and tool result, and an embedding-backed VectorMemory recalls what worked before — each can run on a stronger model than the executor.",
  },
  {
    eyebrow: "hands",
    title: "Real tools, cross-platform",
    body: "bash (pwsh/bash/gitbash), read/write, edit & multi_edit, apply_patch, glob, grep, web_fetch — plus an MCP client that mounts any Model Context Protocol server alongside the built-ins.",
  },
  {
    eyebrow: "super legs",
    title: "It gets better the more you use it",
    body: "Probe a model on first contact, adapt the strategy, then evolve a per-model prompt-variant pool with verifier-grounded scoring. The harness measurably improves across sessions.",
  },
  {
    eyebrow: "the fleet",
    title: "A specialized subagent fleet",
    body: "explore, test, critique — plus frontend-engineer, backend-node/python/go, and data-engineer. Each is a sandboxed child engine with enforced per-tool permission regexes and auto-loaded skills.",
  },
  {
    eyebrow: "control",
    title: "Plan · Auto · Build modes",
    body: "plan is read-only with the planner; build adds the critic and permission prompts; auto runs unattended with prompts auto-allowed — and the safety guards still apply in every mode.",
  },
  {
    eyebrow: "streaming engine",
    title: "A closed-loop controller",
    body: "One async generator emitting 20+ discriminated EngineEvent variants. Token-level abort propagation, loop detection, bounded retries, and snapshot/restore — the engine never prints, it only emits.",
  },
];

const STEPS = [
  ["curl", "curl -fsSL https://raw.githubusercontent.com/hallelx2/omni/main/install.sh | bash"],
  ["irm", "irm https://raw.githubusercontent.com/hallelx2/omni/main/install.ps1 | iex"],
  ["npm", "npm i -g omni-harness"],
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* ── HERO — radial glow + conic aurora + token stream. No grid. ──── */}
      <section className="omni-hero flex flex-col items-center px-6 pb-24 pt-24 text-center sm:pt-32">
        <TokenStream />

        <span className="omni-pill mb-8 rounded-full px-4 py-1.5 text-xs">
          self-improving agent harness · for open + frontier LLMs
        </span>

        <h1 className="max-w-4xl text-balance text-5xl font-bold tracking-tight sm:text-7xl">
          The harness{" "}
          <span className="omni-omega">is the agent.</span>
        </h1>

        <p className="mt-7 max-w-2xl text-balance text-lg leading-relaxed text-fd-muted-foreground sm:text-xl">
          Omni gives <em>any</em> language model — a 7B on your laptop or a
          frontier model — a body to act through, a memory to learn from, and an
          evolving sense of how to use itself. Weaker models become useful when
          the harness around them is strong.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/docs"
            className="rounded-full bg-fd-primary px-7 py-3 text-sm font-semibold text-fd-background transition hover:opacity-90"
          >
            Read the docs →
          </Link>
          <Link
            href="/docs/quick-start"
            className="rounded-full border border-fd-border px-7 py-3 text-sm font-semibold transition hover:border-fd-primary/60 hover:bg-fd-accent"
          >
            Quick start
          </Link>
          <a
            href="https://github.com/hallelx2/omni"
            className="rounded-full px-5 py-3 font-mono text-sm text-fd-muted-foreground transition hover:text-fd-foreground"
          >
            github.com/hallelx2/omni
          </a>
        </div>

        {/* Install terminal card */}
        <div className="omni-card mt-14 w-full max-w-2xl rounded-2xl p-1 text-left">
          <div className="rounded-[14px] bg-fd-background/60 px-5 py-4 backdrop-blur">
            <div className="mb-3 flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-red-500/70" />
              <span className="h-3 w-3 rounded-full bg-yellow-500/70" />
              <span className="h-3 w-3 rounded-full bg-green-500/70" />
              <span className="ml-2 font-mono text-xs text-fd-muted-foreground">
                ~/.omni
              </span>
            </div>
            <div className="space-y-2 font-mono text-sm">
              {STEPS.map(([tag, cmd]) => (
                <div key={tag} className="flex gap-3">
                  <span className="select-none text-fd-primary/80">$</span>
                  <code className="break-all text-fd-foreground/90">{cmd}</code>
                </div>
              ))}
              <div className="flex gap-3 pt-1 text-fd-muted-foreground">
                <span className="select-none text-fd-primary/80">$</span>
                <code>echo &apos;MIMO_API_KEY=tp-...&apos; &gt;&gt; ~/.omni/.env &amp;&amp; omni</code>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ───────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-6xl px-6 pb-24">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="omni-card rounded-2xl p-6">
              <div className="omni-eyebrow mb-3">{f.eyebrow}</div>
              <h3 className="mb-2 text-lg font-semibold tracking-tight">
                {f.title}
              </h3>
              <p className="text-sm leading-relaxed text-fd-muted-foreground">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── THESIS / CTA ───────────────────────────────────────────────── */}
      <section className="mx-auto mb-28 w-full max-w-4xl px-6 text-center">
        <p className="omni-eyebrow mb-4">the thesis</p>
        <p className="text-balance text-2xl font-medium leading-snug sm:text-3xl">
          The model is interchangeable. If the harness probes, plans,
          criticises, remembers, and <span className="omni-omega">evolves</span>
          {" "}— then a model running on your laptop can do real work.
        </p>
        <Link
          href="/docs/self-improvement"
          className="mt-8 inline-block rounded-full border border-fd-border px-7 py-3 text-sm font-semibold transition hover:border-fd-primary/60 hover:bg-fd-accent"
        >
          How self-improvement works →
        </Link>
      </section>
    </main>
  );
}
