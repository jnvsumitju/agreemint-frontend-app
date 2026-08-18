import { useEffect, useMemo, useState } from 'react'
import { PdfViewer } from '../components/pdf/PdfViewer'
import { makeTestPdf } from '../components/pdf/makeTestPdf'

/**
 * Development-only bench for {@link PdfViewer}.
 *
 * <p>The viewer's two real call sites both need a logged-in session and a
 * generated document, which makes the failure modes that matter here — the
 * mount-time render race, virtualization, the canvas budget at wide viewports —
 * awkward to reach and impossible to reach in CI. This route renders the viewer
 * against a PDF built in the browser, so it needs no backend and ships no
 * fixture binary.
 *
 * <p>Mounted only under `import.meta.env.DEV` (see `App.tsx`), which Vite
 * statically replaces, so the route and this module are dropped from production
 * builds entirely.
 *
 * <p>Query parameters, so the Playwright suite can drive it:
 * `?pages=40&width=612&height=792&chrome=0`.
 */
export function PdfViewerHarness() {
  const params = new URLSearchParams(window.location.search)
  const pages = Number(params.get('pages') ?? 3)
  const width = Number(params.get('width') ?? 612)
  const height = Number(params.get('height') ?? 792)
  const chrome = params.get('chrome') !== '0'

  const blob = useMemo(
    () => makeTestPdf({ pages, width, height }),
    [pages, width, height],
  )
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  if (!url) return null

  // Two boxes: the framed one matches DocumentDetail's fixed-height card, the
  // full-bleed one matches the inline preview pane. Both shapes have broken
  // differently in the past, so both are on screen at once.
  return (
    <div className="min-h-screen bg-zinc-50 p-6 dark:bg-zinc-950">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            PdfViewer harness
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {pages} pages · {width}×{height}pt · dev only
          </p>
        </header>

        {chrome ? (
          <section data-harness="framed">
            <h2 className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Fixed-height card (as in DocumentDetail)
            </h2>
            <div className="h-[600px] w-full overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
              <PdfViewer blobUrl={url} downloadFileName="harness.pdf" />
            </div>
          </section>
        ) : null}

        <section data-harness="bleed" className="flex h-[70vh] min-h-0 flex-col">
          <h2 className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Flex pane (as in the preview pane)
          </h2>
          <div className="flex min-h-0 flex-1 flex-col">
            <PdfViewer
              blobUrl={url}
              downloadFileName="harness.pdf"
              className="rounded-lg border border-zinc-200 dark:border-zinc-700"
            />
          </div>
        </section>
      </div>
    </div>
  )
}
