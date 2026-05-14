/**
 * Combine multiple AbortSignals into one. The returned signal aborts as soon
 * as any input signal aborts. Returns a cleanup function to drop listeners.
 */
export function combineSignals(...signals: (AbortSignal | undefined)[]): {
  readonly signal: AbortSignal
  readonly cleanup: () => void
} {
  const controller = new AbortController()
  const listeners: Array<[AbortSignal, () => void]> = []

  for (const s of signals) {
    if (!s) continue
    if (s.aborted) {
      controller.abort(s.reason)
      break
    }
    const onAbort = () => controller.abort(s.reason)
    s.addEventListener("abort", onAbort, { once: true })
    listeners.push([s, onAbort])
  }

  const cleanup = () => {
    for (const [s, l] of listeners) s.removeEventListener("abort", l)
  }
  return { signal: controller.signal, cleanup }
}

import { AsyncQueue } from "./async-queue.ts"

/**
 * Merge multiple async iterables into one. Yields values in arrival order.
 * Each source runs concurrently; this is O(1) per pushed/pulled item.
 */
export async function* mergeStreams<T>(sources: readonly AsyncIterable<T>[]): AsyncIterable<T> {
  if (sources.length === 0) return
  const queue = new AsyncQueue<T>()
  let active = sources.length

  for (const src of sources) {
    void (async () => {
      try {
        for await (const item of src) queue.push(item)
      } finally {
        active--
        if (active === 0) queue.close()
      }
    })()
  }

  for await (const item of queue) yield item
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new DOMException("Aborted", "AbortError"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}
