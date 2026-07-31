import { useEffect, useState } from 'react'
import { Button } from '../ui/Button'
import { PdfZoomMenu } from './PdfZoomMenu'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CollapseIcon,
  DownloadIcon,
  ExpandIcon,
  InfoIcon,
  PrintIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from './pdfIcons'
import type { ZoomMode } from './usePdfPageLayout'

export interface PdfToolbarProps {
  pageNumber: number
  numPages: number
  percent: number
  mode: ZoomMode
  disabled: boolean
  showActions: boolean
  allowFullscreen: boolean
  isFullscreen: boolean
  onGoToPage: (page: number) => void
  onZoomIn: () => void
  onZoomOut: () => void
  onSelectMode: (mode: ZoomMode) => void
  onSelectPercent: (percent: number) => void
  onToggleFullscreen: () => void
  onOpenProperties: () => void
  onPrint: () => void
  onDownload: () => void
}

/**
 * Presentational toolbar. Owns no viewer state beyond the page-number field's
 * own draft text.
 */
export function PdfToolbar({
  pageNumber,
  numPages,
  percent,
  mode,
  disabled,
  showActions,
  allowFullscreen,
  isFullscreen,
  onGoToPage,
  onZoomIn,
  onZoomOut,
  onSelectMode,
  onSelectPercent,
  onToggleFullscreen,
  onOpenProperties,
  onPrint,
  onDownload,
}: PdfToolbarProps) {
  // The field is a draft while focused: typing "12" in a 30-page document goes
  // through "1", and jumping to page 1 mid-keystroke would be maddening.
  const [draft, setDraft] = useState(String(pageNumber))
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(String(pageNumber))
  }, [pageNumber, editing])

  const commit = () => {
    const parsed = Number.parseInt(draft, 10)
    if (Number.isFinite(parsed)) onGoToPage(Math.min(Math.max(parsed, 1), numPages))
    else setDraft(String(pageNumber))
    setEditing(false)
  }

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
      role="toolbar"
      aria-label="Document viewer"
    >
      {showActions ? (
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onOpenProperties}
            disabled={disabled}
            title="Document properties"
            aria-label="Document properties"
            icon={<InfoIcon />}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onPrint}
            disabled={disabled}
            title="Print"
            aria-label="Print"
            icon={<PrintIcon />}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onDownload}
            title="Download"
            aria-label="Download"
            icon={<DownloadIcon />}
          />
        </div>
      ) : null}

      {/* Page navigation, centred and allowed to shrink last. */}
      <div className="mx-auto flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onGoToPage(pageNumber - 1)}
          disabled={disabled || pageNumber <= 1}
          title="Previous page"
          aria-label="Previous page"
          icon={<ChevronLeftIcon />}
        />

        <div className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
            onFocus={(e) => {
              setEditing(true)
              e.target.select()
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setDraft(String(pageNumber))
                setEditing(false)
                e.currentTarget.blur()
              }
              // Every other key stays local — the viewer's shortcuts must not
              // fire while someone is typing a page number.
              e.stopPropagation()
            }}
            disabled={disabled}
            inputMode="numeric"
            aria-label="Page number"
            /* Focus ring copied from Input.tsx:51-56 so the field matches every
               other input in the app; the Input primitive itself is w-full and
               wraps in label/helper markup, which a toolbar cannot use. */
            className="h-7 w-10 rounded-lg border border-zinc-300 bg-white text-center text-xs tabular-nums text-zinc-900 outline-none transition-colors focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20 disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <span className="tabular-nums">/ {numPages || '—'}</span>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => onGoToPage(pageNumber + 1)}
          disabled={disabled || pageNumber >= numPages}
          title="Next page"
          aria-label="Next page"
          icon={<ChevronRightIcon />}
        />
      </div>

      <div className="flex items-center gap-1.5">
        {/* Segmented pill, matching the filter control in Documents.tsx. */}
        <div className="inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-700 dark:bg-zinc-800/50">
          <button
            type="button"
            onClick={onZoomOut}
            disabled={disabled}
            title="Zoom out"
            aria-label="Zoom out"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-white hover:shadow-sm disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            <ZoomOutIcon />
          </button>

          <PdfZoomMenu
            mode={mode}
            percent={percent}
            onSelectMode={onSelectMode}
            onSelectPercent={onSelectPercent}
            disabled={disabled}
          />

          <button
            type="button"
            onClick={onZoomIn}
            disabled={disabled}
            title="Zoom in"
            aria-label="Zoom in"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-white hover:shadow-sm disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            <ZoomInIcon />
          </button>
        </div>

        {allowFullscreen ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onToggleFullscreen}
            title={isFullscreen ? 'Exit full screen (Esc)' : 'Full screen (f)'}
            aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
            icon={isFullscreen ? <CollapseIcon /> : <ExpandIcon />}
          />
        ) : null}
      </div>
    </div>
  )
}
