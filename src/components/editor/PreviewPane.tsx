import { usePreviewStore } from '../../stores/previewStore'
import { PdfViewer } from '../pdf/PdfViewer'

/**
 * Centre pane while previewing: the rendered PDF, in place of the canvas.
 *
 * <p>Regeneration is explicit. Each refresh is two API round-trips — render,
 * then measure for clipping — so refreshing per keystroke would be slow and
 * would flicker the page under the reader. The trade is that what is on screen
 * can fall behind the editor, which is only acceptable if the pane says so:
 * hence the stale notice, which is the piece that makes an explicit button
 * honest rather than merely cheap.
 */
export function PreviewPane() {
  const { loading, error, pdfUrl, stale, generate } = usePreviewStore()

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-zinc-100 dark:bg-zinc-950">
      {/* Refresh bar */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">PDF preview</span>
          {pdfUrl && stale && (
            <span className="truncate rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              Out of date — refresh to see your latest changes
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={loading}
          className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
        >
          {loading ? 'Rendering…' : pdfUrl ? 'Refresh preview' : 'Render preview'}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="max-w-sm text-sm text-red-600 dark:text-red-400">{error}</p>
            <button
              type="button"
              onClick={() => void generate()}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Try again
            </button>
          </div>
        ) : pdfUrl ? (
          <PdfViewer blobUrl={pdfUrl} className="h-full" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {loading ? 'Rendering your document…' : 'No preview yet'}
            </p>
            {!loading && (
              <p className="max-w-xs text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
                Render the document to see exactly what the PDF will look like, and where
                anything gets clipped.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
