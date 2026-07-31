import { describe, expect, it } from 'vitest'
import { PdfRenderQueue, renderPriority } from './pdfRenderQueue'

/** A job whose completion the test controls. */
function deferred() {
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Let queued microtasks drain. The queue is promise-driven, never timer-driven. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe('PdfRenderQueue', () => {
  it('runs up to the concurrency limit and no more', async () => {
    const q = new PdfRenderQueue(2)
    const jobs = [deferred(), deferred(), deferred(), deferred()]
    jobs.forEach((j, i) => q.schedule(`p${i}`, i, () => j.promise))
    await flush()

    expect(q.runningCount).toBe(2)
    expect(q.pendingCount).toBe(2)
  })

  it('starts the next job when a slot frees', async () => {
    const q = new PdfRenderQueue(1)
    const a = deferred()
    const b = deferred()
    q.schedule('a', 0, () => a.promise)
    q.schedule('b', 1, () => b.promise)
    await flush()
    expect(q.runningCount).toBe(1)

    a.resolve()
    await flush()

    expect(q.runningCount).toBe(1)
    expect(q.pendingCount).toBe(0)
  })

  it('frees the slot even when a job rejects', async () => {
    // A single failed page must not wedge the queue for the whole document.
    const q = new PdfRenderQueue(1)
    const a = deferred()
    const b = deferred()
    q.schedule('a', 0, () => a.promise)
    q.schedule('b', 1, () => b.promise)
    await flush()

    a.reject(new Error('render blew up'))
    await flush()

    expect(q.runningCount).toBe(1)
    expect(q.pendingCount).toBe(0)
  })

  it('dequeues by priority, not by insertion order', async () => {
    const q = new PdfRenderQueue(1)
    const order: string[] = []
    const blocker = deferred()
    q.schedule('blocker', -1, () => blocker.promise)
    await flush()

    q.schedule('far', 100, async () => { order.push('far') })
    q.schedule('near', 1, async () => { order.push('near') })
    q.schedule('mid', 50, async () => { order.push('mid') })

    blocker.resolve()
    await flush()
    await flush()
    await flush()

    expect(order).toEqual(['near', 'mid', 'far'])
  })

  it('re-reads priority at dequeue time, so a scroll that lands mid-queue wins', async () => {
    // The reader moved while the first job was in flight. What runs next must be
    // where they are now, not where they were when the work was enqueued.
    const q = new PdfRenderQueue(1)
    const order: string[] = []
    const blocker = deferred()
    q.schedule('blocker', -1, () => blocker.promise)
    await flush()

    q.schedule('page9', 9, async () => { order.push('page9') })
    q.schedule('page2', 2, async () => { order.push('page2') })
    q.schedule('page9', 0, async () => { order.push('page9') }) // scrolled to page 9

    blocker.resolve()
    await flush()
    await flush()

    expect(order[0]).toBe('page9')
  })

  it('re-scheduling a key replaces its job rather than queueing a second', async () => {
    const q = new PdfRenderQueue(1)
    const ran: string[] = []
    const blocker = deferred()
    q.schedule('blocker', -1, () => blocker.promise)
    await flush()

    q.schedule('p1', 5, async () => { ran.push('stale') })
    q.schedule('p1', 5, async () => { ran.push('fresh') })
    expect(q.pendingCount).toBe(1)

    blocker.resolve()
    await flush()
    await flush()

    expect(ran).toEqual(['fresh'])
  })

  it('never runs the same key twice concurrently', async () => {
    // One RenderTask per canvas is the invariant the blank-page bug came from
    // breaking. Re-scheduling a running page must wait, not race it.
    const q = new PdfRenderQueue(4)
    const first = deferred()
    let concurrent = 0
    let maxConcurrent = 0
    const job = () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      return first.promise.finally(() => { concurrent-- })
    }
    q.schedule('same', 0, job)
    await flush()
    q.schedule('same', 0, job)
    await flush()

    expect(maxConcurrent).toBe(1)

    first.resolve()
    await flush()
    await flush()
    expect(maxConcurrent).toBe(1)
  })

  it('cancel drops queued work but leaves running work alone', async () => {
    const q = new PdfRenderQueue(1)
    let farRan = false
    const blocker = deferred()
    q.schedule('blocker', -1, () => blocker.promise)
    await flush()
    q.schedule('far', 10, async () => { farRan = true })

    q.cancel('far')
    blocker.resolve()
    await flush()
    await flush()

    expect(farRan).toBe(false)
    expect(q.pendingCount).toBe(0)
  })

  it('still accepts work after clear() — a StrictMode remount must not kill it', async () => {
    // The queue lives in a useMemo, so it survives StrictMode's simulated
    // unmount while the effect cleanup runs. An earlier version latched itself
    // closed there and every subsequent schedule() silently did nothing, so the
    // viewer never drew a single page. There must be no one-way kill switch.
    const q = new PdfRenderQueue(2)
    let ran = false
    q.schedule('p', 0, async () => {})
    q.clear() // simulated-unmount cleanup
    q.schedule('p', 0, async () => { ran = true }) // effects re-run
    await flush()

    expect(ran).toBe(true)
  })

  it('clear drops queued work without stopping later work', async () => {
    const q = new PdfRenderQueue(1)
    let staleRan = false
    let freshRan = false
    const blocker = deferred()
    q.schedule('blocker', -1, () => blocker.promise)
    await flush()

    q.schedule('stale', 5, async () => { staleRan = true })
    q.clear()
    expect(q.pendingCount).toBe(0)

    q.schedule('fresh', 5, async () => { freshRan = true })
    blocker.resolve()
    await flush()
    await flush()

    expect(staleRan).toBe(false)
    expect(freshRan).toBe(true)
  })
})

describe('renderPriority', () => {
  it('ranks the active page first', () => {
    expect(renderPriority(5, 5)).toBe(0)
  })

  it('ranks nearer pages ahead of farther ones', () => {
    expect(renderPriority(6, 5)).toBeLessThan(renderPriority(8, 5))
    expect(renderPriority(4, 5)).toBeLessThan(renderPriority(1, 5))
  })

  it('breaks ties forward, because reading moves forward', () => {
    expect(renderPriority(6, 5)).toBeLessThan(renderPriority(4, 5))
  })

  it('is total — no two distinct pages tie', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 40; i++) seen.add(renderPriority(i, 17))
    expect(seen.size).toBe(40)
  })
})
