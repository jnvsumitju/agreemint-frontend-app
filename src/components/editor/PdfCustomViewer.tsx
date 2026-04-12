import { useCallback, useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

function formatInfoValue(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v || '—'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

export function PdfCustomViewer({
  blobUrl,
  downloadFileName = 'document.pdf',
}: {
  blobUrl: string
  downloadFileName?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)

  const [numPages, setNumPages] = useState(0)
  const [pageNum, setPageNum] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [propsOpen, setPropsOpen] = useState(false)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [docMeta, setDocMeta] = useState<{
    info: Record<string, unknown>
    byteLength: number
  } | null>(null)

  const renderPage = useCallback(
    async (pdf: PDFDocumentProxy, page: number, widthPx: number, zoom: number) => {
      const canvas = canvasRef.current
      if (!canvas || widthPx < 40) return
      const pdfPage = await pdf.getPage(page)
      const base = pdfPage.getViewport({ scale: 1 })
      const fitScale = Math.min(Math.max((widthPx - 16) / base.width, 0.5), 3)
      const scale = Math.min(Math.max(fitScale * (zoom / 100), 0.2), 5)
      const viewport = pdfPage.getViewport({ scale })
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)
      await pdfPage.render({ canvasContext: ctx, viewport }).promise
    },
    []
  )

  useEffect(() => {
    let cancelled = false
    docRef.current = null
    setLoading(true)
    setLoadErr(null)
    setNumPages(0)
    setPageNum(1)
    setZoomPercent(100)
    setDocMeta(null)

    ;(async () => {
      try {
        const data = await fetch(blobUrl).then((r) => r.arrayBuffer())
        if (cancelled) return
        const task = getDocument({ data })
        const pdf = await task.promise
        if (cancelled) {
          void pdf.destroy()
          return
        }
        docRef.current = pdf
        setNumPages(pdf.numPages)

        let info: Record<string, unknown> = {}
        try {
          const { info: rawInfo } = await pdf.getMetadata()
          if (rawInfo && typeof rawInfo === 'object') {
            info = { ...(rawInfo as Record<string, unknown>) }
          }
        } catch {
          /* ignore */
        }
        let byteLength = data.byteLength
        try {
          const di = await pdf.getDownloadInfo()
          if (typeof di?.length === 'number') byteLength = di.length
        } catch {
          /* ignore */
        }
        if (!cancelled) {
          setDocMeta({ info, byteLength })
        }
      } catch (e) {
        if (!cancelled) {
          setLoadErr(e instanceof Error ? e.message : 'Could not load PDF')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      const d = docRef.current
      docRef.current = null
      if (d) void d.destroy()
    }
  }, [blobUrl])

  useEffect(() => {
    const pdf = docRef.current
    const el = containerRef.current
    if (!pdf || !el || numPages < 1) return

    const run = () => {
      const w = el.clientWidth
      void renderPage(pdf, pageNum, w, zoomPercent)
    }

    run()
    const ro = new ResizeObserver(() => run())
    ro.observe(el)
    return () => ro.disconnect()
  }, [blobUrl, numPages, pageNum, zoomPercent, renderPage])

  const goPrev = () => setPageNum((p) => Math.max(1, p - 1))
  const goNext = () => setPageNum((p) => Math.min(numPages, p + 1))

  const zoomOut = () =>
    setZoomPercent((z) => {
      const next = Math.round(z / 1.15)
      return Math.max(40, next)
    })
  const zoomIn = () =>
    setZoomPercent((z) => {
      const next = Math.round(z * 1.15)
      return Math.min(400, next)
    })

  const handlePrint = () => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    Object.assign(iframe.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '0',
      height: '0',
      border: '0',
      visibility: 'hidden',
    })
    iframe.src = blobUrl
    document.body.appendChild(iframe)
    iframe.onload = () => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      setTimeout(() => {
        document.body.removeChild(iframe)
      }, 2000)
    }
  }

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = downloadFileName
    a.rel = 'noopener'
    a.click()
  }

  const infoEntries = docMeta
    ? Object.entries(docMeta.info).filter(([k]) => k !== 'raw' && !k.startsWith('_'))
    : []

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-zinc-900 text-zinc-100">
      <div
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-700 bg-zinc-900 px-2 py-1.5"
        role="toolbar"
        aria-label="PDF actions"
      >
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          onClick={() => setPropsOpen(true)}
          disabled={!docMeta}
        >
          Document properties
        </button>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          onClick={handlePrint}
        >
          Print
        </button>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          onClick={handleDownload}
        >
          Download
        </button>
        <span className="hidden h-4 w-px bg-zinc-600 sm:inline" aria-hidden />
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2 sm:justify-end">
          <div className="flex items-center gap-0.5 rounded-md border border-zinc-700 bg-zinc-800/80 px-0.5">
            <button
              type="button"
              className="rounded px-2 py-0.5 text-base leading-none text-zinc-300 hover:bg-zinc-700 disabled:opacity-30"
              onClick={zoomOut}
              disabled={loading || zoomPercent <= 40}
              aria-label="Zoom out"
            >
              −
            </button>
            <span className="min-w-[2.75rem] select-none text-center text-[11px] tabular-nums text-zinc-400">
              {zoomPercent}%
            </span>
            <button
              type="button"
              className="rounded px-2 py-0.5 text-base leading-none text-zinc-300 hover:bg-zinc-700 disabled:opacity-30"
              onClick={zoomIn}
              disabled={loading || zoomPercent >= 400}
              aria-label="Zoom in"
            >
              +
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-md px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
              onClick={goPrev}
              disabled={pageNum <= 1 || loading}
              aria-label="Previous page"
            >
              ‹
            </button>
            <span className="min-w-[4.5rem] text-center text-xs tabular-nums text-zinc-400">
              {numPages > 0 ? `${pageNum} / ${numPages}` : '—'}
            </span>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
              onClick={goNext}
              disabled={pageNum >= numPages || loading || numPages === 0}
              aria-label="Next page"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-auto bg-zinc-800/90 p-3 sm:p-4"
      >
        {loadErr ? (
          <p className="text-center text-sm text-red-400">{loadErr}</p>
        ) : loading ? (
          <p className="text-center text-sm text-zinc-500">Loading PDF…</p>
        ) : (
          <div className="flex justify-center">
            <canvas ref={canvasRef} className="shadow-lg" />
          </div>
        )}
      </div>

      {propsOpen && docMeta ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pdf-props-title"
          onClick={() => setPropsOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-xl border border-zinc-600 bg-zinc-900 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
              <h3 id="pdf-props-title" className="text-sm font-semibold text-zinc-100">
                Document properties
              </h3>
              <button
                type="button"
                className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                onClick={() => setPropsOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-4 text-xs">
              <dl className="space-y-2">
                <div className="flex justify-between gap-4 border-b border-zinc-800 py-1">
                  <dt className="shrink-0 text-zinc-500">Pages</dt>
                  <dd className="text-right text-zinc-200">{numPages}</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-zinc-800 py-1">
                  <dt className="shrink-0 text-zinc-500">File size</dt>
                  <dd className="text-right text-zinc-200 tabular-nums">
                    {(docMeta.byteLength / 1024).toFixed(1)} KB
                  </dd>
                </div>
                {infoEntries.length === 0 ? (
                  <p className="py-2 text-zinc-500">No extra metadata in this PDF.</p>
                ) : (
                  infoEntries.map(([key, val]) => (
                    <div
                      key={key}
                      className="flex justify-between gap-4 border-b border-zinc-800 py-1"
                    >
                      <dt className="shrink-0 text-zinc-500">{key}</dt>
                      <dd className="break-all text-right text-zinc-200">{formatInfoValue(val)}</dd>
                    </div>
                  ))
                )}
              </dl>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
