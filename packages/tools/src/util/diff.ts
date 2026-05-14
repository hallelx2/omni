/**
 * Produce a short, model-readable unified-diff-ish summary of an edit.
 * Not a real unified diff — just enough context for the model to verify
 * the change happened where it expected.
 *
 *   - Up to `contextLines` of context before and after each change
 *   - "..." lines indicate elided spans
 *
 * Cheap, dependency-free, good enough for confirmation.
 */
export function summarizeChange(
  before: string,
  after: string,
  contextLines = 2,
): string {
  if (before === after) return "(no change)"

  const b = before.split("\n")
  const a = after.split("\n")
  const maxLen = Math.max(b.length, a.length)

  // Find diverging lines (linear scan; fine for short edits, fine enough for long).
  const diffLines: Array<{ kind: "context" | "del" | "add"; line: string; n: number }> = []
  let i = 0
  let j = 0
  while (i < b.length || j < a.length) {
    if (i < b.length && j < a.length && b[i] === a[j]) {
      diffLines.push({ kind: "context", line: b[i]!, n: i + 1 })
      i++
      j++
    } else {
      // Find the next sync point — greedy lookahead.
      const sync = findNextSync(b, a, i, j, 50)
      while (i < sync.bi) {
        diffLines.push({ kind: "del", line: b[i]!, n: i + 1 })
        i++
      }
      while (j < sync.aj) {
        diffLines.push({ kind: "add", line: a[j]!, n: j + 1 })
        j++
      }
    }
  }

  // Now keep change lines + N lines of context.
  const out: string[] = []
  for (let k = 0; k < diffLines.length; k++) {
    const line = diffLines[k]!
    if (line.kind !== "context") {
      out.push(line.kind === "del" ? `- ${line.line}` : `+ ${line.line}`)
      continue
    }
    const nextChange = diffLines.slice(k + 1, k + 1 + contextLines).some((d) => d.kind !== "context")
    const prevChange = diffLines.slice(Math.max(0, k - contextLines), k).some((d) => d.kind !== "context")
    if (nextChange || prevChange) out.push(`  ${line.line}`)
  }

  const dropped = maxLen - out.length
  if (dropped > 0) out.push(`  ... (${dropped} unchanged lines elided)`)
  return out.join("\n")
}

function findNextSync(b: string[], a: string[], i0: number, j0: number, window: number) {
  for (let d = 1; d <= window; d++) {
    for (let i = i0; i <= Math.min(b.length, i0 + d); i++) {
      for (let j = j0; j <= Math.min(a.length, j0 + d); j++) {
        if (b[i] !== undefined && a[j] !== undefined && b[i] === a[j]) {
          return { bi: i, aj: j }
        }
      }
    }
  }
  return { bi: b.length, aj: a.length }
}
