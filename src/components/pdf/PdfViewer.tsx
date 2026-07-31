import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PixelsPerInch } from 'pdfjs-dist'
import { EmptyState } from '../ui/EmptyState'
import { PdfFullscreenOverlay } from './PdfFullscreenOverlay'
import { PdfPageCanvas } from './PdfPageCanvas'
import { PdfPropertiesModal } from './PdfPropertiesModal'
import { PdfToolbar } from './PdfToolbar'
import { PdfRenderQueue, renderPriority } from './pdfRenderQueue'
import { LockIcon, WarningIcon } from './pdfIcons'
import { MAX_ZOOM, MIN_ZOOM, nextZoomStep, prevZoomStep, scrollTopForPage } from './pageLayout'
import { WELL_PADDING, usePdfPageLayout, type ZoomMode } from './usePdfPageLayout'
import { usePdfDocument } from './usePdfDocument'

/**
 * CSS pixels per PDF point at 100%. There is no top-level `PDF_TO_CSS_UNITS`
 * export in pdfjs-dist 4.10.38 — it lives on `PixelsPerInch`.
 */
const PDF_TO_CSS = PixelsPerInch.PDF_TO_CSS_UNITS

export interface PdfViewerProps {
  blobUrl: string
  downloadFileName?: string
  /** Default true. */
  allowFullscreen?: boolean
  /** Properties / print / download. Default true. */
  showActions?: boolean
  /** Default 'fit-width'. */
  initialZoom?: ZoomMode
  /** Callers own the border and radius; the viewer fills whatever box it is given. */
  className?: string
}

/**
 * Continuous-scroll PDF viewer.
 *
 * <p>Replaces `editor/PdfCustomViewer`, which rendered one page at a time into a
 * hard-coded dark chrome with no `dark:` variants — the only surface in the app
 * that ignored the theme — and which went blank on first paint because two
 * renders raced for the same canvas.
 *
 * <p>Page tiles are virtualized: every page reserves its laid-out box so the
 * scrollbar is honest from the first frame, but only pages near the viewport
 * mount a canvas. See `pageLayout.ts` for the geometry and `pdfRenderQueue.ts`
 * for the scheduling.
 */
export function PdfViewer({
  blobUrl,
  downloadFileName = 'document.pdf',
  allowFullscreen = true,
  showActions = true,
  initialZoom = 'fit-width',
  className,
}: PdfViewerProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<ZoomMode>(initialZoom)
  const [customPercent, setCustomPercent] = useState(100)
  const [propsOpen, setPropsOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  const { pdf, numPages, meta, loading, error, reload } = usePdfDocument(blobUrl)

  // One queue per viewer instance. Two concurrent renders keeps the page in
  // view responsive without letting a fast scroll saturate the main thread.
  // Cleared rather than disposed on teardown — see PdfRenderQueue.clear().
  const queue = useMemo(() => new PdfRenderQueue(2), [])
  useEffect(() => () => queue.clear(), [queue])

  const { sizes, scale, percent, layout, activePage, window: pageWindow, isScrolling } =
    usePdfPageLayout({
      pdf,
      numPages,
      scrollerRef,
      mode,
      customPercent,
      pdfToCssUnits: PDF_TO_CSS,
    })

  const goToPage = useCallback(
    (page: number) => {
      const el = scrollerRef.current
      if (!el || layout.sizes.length === 0) return
      const index = Math.min(Math.max(page - 1, 0), layout.sizes.length - 1)
      el.scrollTo({ top: scrollTopForPage(layout, index, el.clientHeight), behavior: 'smooth' })
    },
    [layout],
  )

  // applyZoom restores the scroll position from the layout that exists *after*
  // the state change, so it has to read it from a ref rather than the closure.
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  /**
   * Zoom about the page in view.
   *
   * <p>Changing scale moves every offset, so without this the reader is thrown
   * to a different part of the document on every zoom step. Restoring by page
   * rather than by ratio keeps them on the page they were reading.
   */
  const applyZoom = useCallback((next: () => void) => {
    const anchor = activePage
    next()
    // Two frames: one for React to commit the new scale, one for the browser to
    // lay the taller content out. Reading scrollTop before that clamps against
    // the old height.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const node = scrollerRef.current
        if (node) node.scrollTop = scrollTopForPage(layoutRef.current, anchor, node.clientHeight)
      })
    })
  }, [activePage])

  const zoomIn = useCallback(() => {
    applyZoom(() => {
      setCustomPercent((p) => nextZoomStep(mode === 'custom' ? p : percent))
      setMode('custom')
    })
  }, [applyZoom, mode, percent])

  const zoomOut = useCallback(() => {
    applyZoom(() => {
      setCustomPercent((p) => prevZoomStep(mode === 'custom' ? p : percent))
      setMode('custom')
    })
  }, [applyZoom, mode, percent])

  const selectMode = useCallback((m: ZoomMode) => applyZoom(() => setMode(m)), [applyZoom])

  const selectPercent = useCallback(
    (p: number) => applyZoom(() => {
      setCustomPercent(Math.min(Math.max(p, MIN_ZOOM), MAX_ZOOM))
      setMode('custom')
    }),
    [applyZoom],
  )

  const handleDownload = useCallback(() => {
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = downloadFileName
    a.rel = 'noopener'
    a.click()
  }, [blobUrl, downloadFileName])

  const handlePrint = useCallback(() => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    Object.assign(iframe.style, {
      position: 'fixed', right: '0', bottom: '0',
      width: '0', height: '0', border: '0', visibility: 'hidden',
    })
    iframe.src = blobUrl
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
      } catch {
        // Blob-URL printing is refused by some browsers; a download is the
        // honest fallback rather than a button that silently does nothing.
        handleDownload()
      }
      setTimeout(() => iframe.remove(), 2000)
    }
    document.body.appendChild(iframe)
  }, [blobUrl, handleDownload])

  /* ── Keyboard, bound on the scroller rather than the window ──────────────
     A page-level listener would hijack these keys for every other viewer and
     every input on the page. Arrows and Space are deliberately left alone so
     native scrolling keeps working. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const el = scrollerRef.current
      if (!el || numPages === 0) return
      const mod = e.metaKey || e.ctrlKey

      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn(); return }
      if (mod && e.key === '-') { e.preventDefault(); zoomOut(); return }
      if (mod && e.key === '0') { e.preventDefault(); selectMode('actual'); return }
      if (mod) return

      switch (e.key) {
        case 'PageDown': e.preventDefault(); goToPage(activePage + 2); break
        case 'PageUp': e.preventDefault(); goToPage(activePage); break
        case 'Home': e.preventDefault(); goToPage(1); break
        case 'End': e.preventDefault(); goToPage(numPages); break
        case 'n': case 'j': goToPage(activePage + 2); break
        case 'p': case 'k': goToPage(activePage); break
        case '+': case '=': zoomIn(); break
        case '-': zoomOut(); break
        case '0': selectMode('actual'); break
        case '1': selectMode('fit-width'); break
        case '9': selectMode('fit-page'); break
        case 'f':
          if (allowFullscreen) setFullscreen((v) => !v)
          break
        default:
      }
    },
    [activePage, numPages, goToPage, zoomIn, zoomOut, selectMode, allowFullscreen],
  )

  // Ctrl/Cmd+wheel zoom, non-passive so preventDefault actually suppresses the
  // browser's own page zoom.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      if (e.deltaY < 0) zoomIn()
      else if (e.deltaY > 0) zoomOut()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomIn, zoomOut])

  const disabled = loading || !!error || numPages === 0

  const body = error ? (
    <div className="flex flex-1 items-center justify-center p-6">
      <EmptyState
        className="border-none"
        icon={error.kind === 'password'
          ? <LockIcon className="h-8 w-8" />
          : <WarningIcon className="h-8 w-8" />}
        title={
          error.kind === 'password' ? 'Password-protected'
            : error.kind === 'corrupt' ? 'Cannot read this file'
            : error.kind === 'network' ? 'Download failed'
            : 'Cannot open this document'
        }
        description={error.message}
        action={error.kind === 'network' ? { label: 'Try again', onClick: reload } : undefined}
        secondaryAction={{ label: 'Download instead', onClick: handleDownload }}
      />
    </div>
  ) : (
    <div
      ref={scrollerRef}
      data-pdf-scroller
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 overflow-auto overscroll-contain bg-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500/40 dark:bg-zinc-950"
      style={{ padding: WELL_PADDING }}
    >
      {loading || sizes.length === 0 ? (
        // Page-shaped rather than a spinner, so the layout does not jump when
        // the real first page replaces it.
        <div className="mx-auto w-full max-w-3xl">
          <div className="mx-auto aspect-[8.5/11] w-full animate-pulse rounded bg-white shadow-sm ring-1 ring-zinc-900/10 dark:bg-zinc-900 dark:ring-white/10" />
        </div>
      ) : (
        <div
          className="relative mx-auto"
          style={{ width: layout.contentWidth, height: layout.totalHeight }}
        >
          {layout.sizes.map((size, i) => {
            const inWindow = i >= pageWindow.start && i <= pageWindow.end
            // While the reader is moving, only the page under the midpoint is
            // worth the work; its neighbours fill in when they settle.
            const shouldRender = inWindow && (!isScrolling || i === activePage)
            return (
              <div
                key={i}
                className="absolute left-0"
                style={{ top: layout.offsets[i], width: size.width, height: size.height }}
              >
                {shouldRender && pdf ? (
                  <PdfPageCanvas
                    pdf={pdf}
                    pageNumber={i + 1}
                    cssWidth={size.width}
                    cssHeight={size.height}
                    scale={scale}
                    queue={queue}
                    priority={renderPriority(i, activePage)}
                  />
                ) : (
                  <div className="h-full w-full rounded-[1px] bg-white shadow-sm ring-1 ring-zinc-900/10 dark:ring-white/10" />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  const shell = (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-zinc-900 ${className ?? ''}`}
    >
      <PdfToolbar
        pageNumber={activePage + 1}
        numPages={numPages}
        percent={percent}
        mode={mode}
        disabled={disabled}
        showActions={showActions}
        allowFullscreen={allowFullscreen}
        isFullscreen={fullscreen}
        onGoToPage={goToPage}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onSelectMode={selectMode}
        onSelectPercent={selectPercent}
        onToggleFullscreen={() => setFullscreen((v) => !v)}
        onOpenProperties={() => setPropsOpen(true)}
        onPrint={handlePrint}
        onDownload={handleDownload}
      />
      {body}

      {/* Inside the viewer subtree on purpose: in fullscreen the overlay owns
          the stacking context, and a body-portalled dialog would land behind
          the pages. */}
      <PdfPropertiesModal
        open={propsOpen}
        onClose={() => setPropsOpen(false)}
        meta={meta}
        numPages={numPages}
        firstPageSize={sizes[0]}
      />
    </div>
  )

  if (!fullscreen) return shell

  return (
    <PdfFullscreenOverlay onClose={() => setFullscreen(false)} suppressEscape={propsOpen}>
      {shell}
    </PdfFullscreenOverlay>
  )
}
