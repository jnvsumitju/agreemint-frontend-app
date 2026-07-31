import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { currentCanvasBudget, resolveOutputScale } from './canvasBudget'
import type { PdfRenderQueue } from './pdfRenderQueue'
import { RetryIcon, WarningIcon } from './pdfIcons'

type TileState = 'blank' | 'rendering' | 'done' | 'error'

export interface PdfPageCanvasProps {
  pdf: PDFDocumentProxy
  /** 1-based, as pdf.js numbers pages. */
  pageNumber: number
  /** Laid-out size of this page in CSS pixels. */
  cssWidth: number
  cssHeight: number
  /** pdf.js viewport scale: PDF points → CSS pixels. */
  scale: number
  queue: PdfRenderQueue
  /** Lower runs sooner. See {@link renderPriority}. */
  priority: number
}

/**
 * One page of the document.
 *
 * <p>The wrapper is always exactly the laid-out page size, whether or not the
 * canvas has painted yet, so scrolling never reflows and the scrollbar never
 * jumps. Only the bitmap inside it is asynchronous.
 *
 * <p>This component owns the render lifecycle, and the order of its steps is
 * the fix for the blank-page bug the rebuild exists to close. See
 * {@link renderNow}.
 */
export function PdfPageCanvas({
  pdf,
  pageNumber,
  cssWidth,
  cssHeight,
  scale,
  queue,
  priority,
}: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const taskRef = useRef<RenderTask | null>(null)
  const pageRef = useRef<PDFPageProxy | null>(null)
  /** Geometry already painted, so a re-schedule at the same size is a no-op. */
  const paintedRef = useRef<string | null>(null)
  /** Bumped on every attempt; a settled render whose token is stale is discarded. */
  const tokenRef = useRef(0)

  const [state, setState] = useState<TileState>('blank')
  const [retry, setRetry] = useState(0)

  const key = `p${pageNumber}`
  const geometry = `${Math.round(cssWidth)}x${Math.round(cssHeight)}@${scale.toFixed(4)}#${retry}`

  const renderNow = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || !(cssWidth > 0) || !(cssHeight > 0)) return
    if (paintedRef.current === geometry) return

    const token = ++tokenRef.current

    // ── 1. Stand down any render already using this canvas, and WAIT for it.
    //
    // Ordering is the entire bug. Assigning canvas.width clears the bitmap and
    // resets the 2D context transform; doing that while pdf.js is mid-draw
    // leaves the in-flight render painting into a wiped context, and pdf.js
    // refuses the second render outright — "Cannot use the same canvas during
    // multiple render() operations" (pdf.mjs:13119). The page comes out blank
    // with nothing thrown where anyone would see it, and any later single
    // re-render fixes it. That is exactly the "zoom out and back in" symptom.
    //
    // cancel() frees pdf.js's canvas slot synchronously, but the promise must
    // still settle before the canvas is touched at all.
    const previous = taskRef.current
    if (previous) {
      previous.cancel()
      await previous.promise.catch(() => { /* cancellation is expected */ })
      if (taskRef.current === previous) taskRef.current = null
    }
    if (token !== tokenRef.current) return

    setState('rendering')

    try {
      const page = pageRef.current ?? (await pdf.getPage(pageNumber))
      if (token !== tokenRef.current) return
      pageRef.current = page

      const viewport = page.getViewport({ scale })

      // ── 2. Clamp the backing store to something the browser will paint.
      // Past the limit a canvas allocates without error and then paints
      // nothing. Blurry beats blank, so this reduces resolution and never
      // refuses to render.
      const budget = currentCanvasBudget()
      const outputScale = resolveOutputScale(
        viewport.width,
        viewport.height,
        window.devicePixelRatio || 1,
        budget,
      )
      const targetW = Math.max(1, Math.floor(viewport.width * outputScale))
      const targetH = Math.max(1, Math.floor(viewport.height * outputScale))

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        setState('error')
        return
      }

      // ── 3. Resize only when the size actually changed. A re-render at the
      // same geometry then never goes through the bitmap-clearing path.
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW
        canvas.height = targetH
      } else {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, targetW, targetH)
      }

      const effective = targetW / viewport.width

      // ── 4. Scale via RenderParameters.transform, not an outer ctx.scale — a
      // context reset can silently drop the latter, whereas pdf.js applies this
      // one inside its own save/restore.
      const task = page.render({
        canvasContext: ctx,
        viewport,
        transform: [effective, 0, 0, effective, 0, 0],
        background: '#ffffff',
      })
      taskRef.current = task

      await task.promise
      if (token !== tokenRef.current) return

      paintedRef.current = geometry
      setState('done')
    } catch (e) {
      // A cancellation is this tile superseding itself, or the document being
      // torn down — not a failure worth showing anyone.
      if ((e as { name?: string })?.name === 'RenderingCancelledException') return
      if (token !== tokenRef.current) return
      paintedRef.current = null
      setState('error')
    } finally {
      if (taskRef.current && token === tokenRef.current) taskRef.current = null
    }
  }, [pdf, pageNumber, cssWidth, cssHeight, scale, geometry])

  useEffect(() => {
    queue.schedule(key, priority, renderNow)
  }, [queue, key, priority, renderNow])

  // Teardown: order matters. Cancel and let the task settle before releasing
  // the bitmap, or pdf.js writes into a canvas that has just been zeroed.
  useEffect(() => {
    const canvas = canvasRef.current
    return () => {
      tokenRef.current++
      queue.cancel(key)
      const task = taskRef.current
      taskRef.current = null
      const page = pageRef.current
      pageRef.current = null

      const release = () => {
        if (canvas) {
          canvas.width = 0
          canvas.height = 0
        }
        // cleanup() is a no-op while a render is live, hence the await above.
        page?.cleanup()
      }

      if (task) {
        task.cancel()
        void task.promise.catch(() => {}).then(release)
      } else {
        release()
      }
    }
  }, [queue, key])

  return (
    <div
      data-pdf-page={pageNumber}
      /* Exposed so the e2e suite can wait for a page to actually finish rather
         than sleeping, and so a stuck tile is diagnosable from the DOM. */
      data-pdf-page-state={state}
      className="relative shrink-0 bg-white shadow-sm ring-1 ring-zinc-900/10 dark:ring-white/10"
      style={{ width: cssWidth, height: cssHeight }}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{ opacity: state === 'done' ? 1 : 0, transition: 'opacity 120ms ease-out' }}
      />

      {state === 'error' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white p-4 text-center">
          <WarningIcon className="h-6 w-6 text-amber-500" />
          <p className="text-xs text-zinc-500">Page {pageNumber} could not be drawn.</p>
          <button
            type="button"
            onClick={() => {
              paintedRef.current = null
              setRetry((n) => n + 1)
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            <RetryIcon className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      ) : state !== 'done' ? (
        // Page-shaped placeholder rather than a spinner: the tile is already the
        // right size, so a shimmer in place reads as the page arriving instead
        // of as something separate loading on top of it.
        <div className="absolute inset-0 animate-pulse bg-zinc-100 dark:bg-zinc-800/60" />
      ) : null}
    </div>
  )
}
