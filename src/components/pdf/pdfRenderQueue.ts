/**
 * Concurrency-limited, priority-ordered scheduler for page renders.
 *
 * <p>A continuous-scroll viewer wants to start far more renders than it should
 * run at once. Scrolling through a 40-page document can queue every page in a
 * second; firing them all hands pdf.js dozens of simultaneous jobs, each holding
 * a full-page canvas, and the page the reader is actually looking at finishes
 * last because it is stuck behind pages they have already scrolled past.
 *
 * <p>So work is queued rather than started, ordered by distance from the page in
 * view, and at most {@link maxConcurrent} run at a time. Priority is re-read at
 * dequeue time, not enqueue time: by the time a slot frees up the reader has
 * usually moved, and the right next job is the one nearest to where they are
 * *now*.
 *
 * <p>Deliberately DOM-free and pdf.js-free so it can be unit-tested directly.
 * It schedules opaque thunks; cancelling the actual pdf.js `RenderTask` is the
 * caller's job, because only the caller knows about the canvas.
 */

export type RenderJob = () => Promise<void>

interface Pending {
  key: string
  priority: number
  run: RenderJob
}

export class PdfRenderQueue {
  private readonly maxConcurrent: number
  private readonly pending = new Map<string, Pending>()
  private readonly running = new Set<string>()

  constructor(maxConcurrent = 2) {
    this.maxConcurrent = Math.max(1, maxConcurrent)
  }

  /**
   * Queue work for `key`, or re-prioritise it if already queued.
   *
   * <p>Re-queueing a key that is already *running* records the new job as
   * pending rather than starting a second one, so a page whose zoom changed
   * mid-render redraws once the first attempt settles instead of racing it. One
   * render per canvas at a time is the invariant the whole viewer depends on.
   */
  schedule(key: string, priority: number, run: RenderJob): void {
    this.pending.set(key, { key, priority, run })
    this.pump()
  }

  /** Drop queued work for `key`. Work already running is left to settle. */
  cancel(key: string): void {
    this.pending.delete(key)
  }

  /**
   * Drop everything queued. In-flight jobs still settle; their results are the
   * caller's to discard.
   *
   * <p>There is deliberately no `dispose()` that latches the queue closed. The
   * queue lives in a `useMemo`, so it survives StrictMode's simulated unmount
   * while an effect cleanup runs — a one-way kill switch would be tripped during
   * that dry run and every later `schedule()` would silently do nothing, which
   * is exactly the blank viewer this class exists to prevent. Tiles cancel their
   * own work on unmount and every job re-checks its token before touching a
   * canvas, so an obsolete job is already harmless without a latch.
   */
  clear(): void {
    this.pending.clear()
  }

  /** Queued but not yet started. Exposed for tests and diagnostics. */
  get pendingCount(): number {
    return this.pending.size
  }

  /** Currently executing. Exposed for tests and diagnostics. */
  get runningCount(): number {
    return this.running.size
  }

  private pump(): void {
    while (this.running.size < this.maxConcurrent) {
      const next = this.takeHighestPriority()
      if (!next) return
      this.running.add(next.key)
      // Errors are the tile's to surface — the queue only owns the slot, and
      // must free it whether the job resolved or threw.
      void Promise.resolve()
        .then(next.run)
        .catch(() => { /* per-tile error handling lives in the caller */ })
        .finally(() => {
          this.running.delete(next.key)
          this.pump()
        })
    }
  }

  /**
   * Lowest priority number wins, and a key already running is skipped rather
   * than removed — it stays queued so it starts the moment its slot frees.
   */
  private takeHighestPriority(): Pending | null {
    let best: Pending | null = null
    for (const entry of this.pending.values()) {
      if (this.running.has(entry.key)) continue
      if (best === null || entry.priority < best.priority) best = entry
    }
    if (best) this.pending.delete(best.key)
    return best
  }
}

/**
 * Scheduling priority for a page: distance from the page in view.
 *
 * <p>Ties break toward the page *after* the active one, since reading moves
 * forward — at the midpoint of a scroll the next page matters more than the
 * previous one.
 */
export function renderPriority(pageIndex: number, activeIndex: number): number {
  const distance = Math.abs(pageIndex - activeIndex)
  return pageIndex >= activeIndex ? distance * 2 : distance * 2 + 1
}
