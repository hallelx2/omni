"use client";

import { useMemo } from "react";

const TOKENS = [
  "probe()",
  "adapt()",
  "scoreTrace",
  "verifier: pass",
  "engine.iteration",
  "model.delta",
  "tool.result",
  "adaptFromPool",
  "ε-greedy",
  "recordTrial",
  "dispatch_agents",
  "AsyncIterable<Event>",
  "snapshot()",
  "MIMO_API_KEY",
  "/evolve",
  "permission_granted",
  "VectorMemory",
  "critic.verdict",
  "Ω",
  "mutatePrompt",
  "tournamentSelect",
  "skills:",
];

/**
 * A subtle, low-opacity stream of harness tokens drifting upward behind the
 * hero. Deterministic per-mount layout (seeded from index) so SSR and client
 * agree on structure; only CSS animation differs. Honors prefers-reduced-motion
 * via the .omni-token-stream CSS rule.
 */
export function TokenStream() {
  const items = useMemo(() => {
    return Array.from({ length: 22 }).map((_, i) => {
      // Deterministic pseudo-random from index — stable across SSR/CSR.
      const r = (n: number) => ((Math.sin((i + 1) * n) + 1) / 2);
      return {
        token: TOKENS[i % TOKENS.length],
        left: `${(r(12.9898) * 100).toFixed(2)}%`,
        delay: `${(r(78.233) * 16).toFixed(2)}s`,
        duration: `${(14 + r(43.21) * 16).toFixed(2)}s`,
        size: `${(0.6 + r(7.31) * 0.45).toFixed(2)}rem`,
      };
    });
  }, []);

  return (
    <div className="omni-token-stream" aria-hidden>
      {items.map((it, i) => (
        <span
          key={i}
          style={{
            left: it.left,
            animationDelay: it.delay,
            animationDuration: it.duration,
            fontSize: it.size,
          }}
        >
          {it.token}
        </span>
      ))}
    </div>
  );
}
