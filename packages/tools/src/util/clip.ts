/**
 * Clip a string to a maximum byte budget. If oversized, keep a head and tail
 * window and replace the middle with a marker showing how many bytes were
 * dropped — preserves both the start and the most recent output, which is
 * what callers usually want.
 */
export function clip(
  s: string,
  maxBytes: number,
): { readonly text: string; readonly truncated: boolean } {
  if (s.length <= maxBytes) return { text: s, truncated: false }
  const headSize = Math.floor(maxBytes * 0.8)
  const tailSize = Math.floor(maxBytes * 0.15)
  const head = s.slice(0, headSize)
  const tail = s.slice(-tailSize)
  const dropped = s.length - head.length - tail.length
  return {
    text: `${head}\n\n[... ${dropped} bytes truncated ...]\n\n${tail}`,
    truncated: true,
  }
}
