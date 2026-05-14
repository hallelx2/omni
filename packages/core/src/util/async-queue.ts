/**
 * A bounded FIFO async queue with explicit close semantics.
 *
 * - {@link push} appends an item (no-op once closed).
 * - {@link close} signals end of stream; pending and future `next()` resolve `done`.
 * - `[Symbol.asyncIterator]` drains items in FIFO order until closed and empty.
 *
 * Used by:
 *   - {@link mergeStreams} to coalesce events from concurrent async iterables.
 *   - The engine's tool executor to interleave tool progress with completion.
 *
 * O(1) per push and per pull.
 */
export class AsyncQueue<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private readonly _buffer: T[] = []
  private readonly _waiters: Array<(r: IteratorResult<T>) => void> = []
  private _closed = false

  push(value: T): void {
    if (this._closed) return
    const w = this._waiters.shift()
    if (w) w({ value, done: false })
    else this._buffer.push(value)
  }

  close(): void {
    if (this._closed) return
    this._closed = true
    while (this._waiters.length > 0) {
      this._waiters.shift()!({ value: undefined as unknown as T, done: true })
    }
  }

  isClosed(): boolean {
    return this._closed
  }

  next(): Promise<IteratorResult<T>> {
    if (this._buffer.length > 0) {
      return Promise.resolve({ value: this._buffer.shift()!, done: false })
    }
    if (this._closed) {
      return Promise.resolve({ value: undefined as unknown as T, done: true })
    }
    return new Promise((resolve) => this._waiters.push(resolve))
  }

  return(): Promise<IteratorResult<T>> {
    this.close()
    return Promise.resolve({ value: undefined as unknown as T, done: true })
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this
  }
}
