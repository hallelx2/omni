import { describe, expect, test } from "bun:test"
import { AsyncQueue } from "../src/util/async-queue.ts"

describe("AsyncQueue", () => {
  test("delivers pushed items in FIFO order", async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    q.push(2)
    q.push(3)
    q.close()
    const out: number[] = []
    for await (const v of q) out.push(v)
    expect(out).toEqual([1, 2, 3])
  })

  test("pull then push delivers immediately to waiter", async () => {
    const q = new AsyncQueue<string>()
    const pull = q.next()
    q.push("hello")
    const r = await pull
    expect(r.done).toBe(false)
    expect(r.value).toBe("hello")
  })

  test("close resolves all pending waiters as done", async () => {
    const q = new AsyncQueue<number>()
    const a = q.next()
    const b = q.next()
    q.close()
    const [ra, rb] = await Promise.all([a, b])
    expect(ra.done).toBe(true)
    expect(rb.done).toBe(true)
  })

  test("pushes after close are ignored", async () => {
    const q = new AsyncQueue<number>()
    q.close()
    q.push(99)
    const r = await q.next()
    expect(r.done).toBe(true)
  })

  test("close is idempotent", () => {
    const q = new AsyncQueue<number>()
    q.close()
    q.close() // must not throw
    expect(q.isClosed()).toBe(true)
  })

  test("return() closes and finalizes the iterator", async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    q.push(2)
    const it = q[Symbol.asyncIterator]()
    expect((await it.next()).value).toBe(1)
    const r = await it.return!()
    expect(r.done).toBe(true)
  })
})
