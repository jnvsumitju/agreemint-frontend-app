import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { generatePreviewPdf, measureLayout } from '../../lib/api'
import { buildLayoutJson, type LayoutJson } from '../../types/layout'
import {
  getTableColumnsForDataKey,
  parseTableRowsFromJson,
  scalarVariableKeys,
  tableRowsToPayload,
} from '../../lib/previewFormData'
import { variableValuesToDataTree } from '../../lib/layoutBehaviourResolve'
import {
  defaultSampleTableRowsJson,
  extractVariableKeys,
  uniqueTableDataKeys,
} from '../../lib/variables'
import { selectAllTemplateElements, useEditorStore } from '../../stores/editorStore'
import { serializeRunsToContent } from '../../lib/richContent'
import { findOverflowingElements, type Overflow } from '../../lib/overflowCheck'
import { pixelParityEnabled } from '../../lib/features'
import { PdfCustomViewer } from './PdfCustomViewer'
import { PreviewDataPanel } from './PreviewDataPanel'

interface PreviewModalProps {
  open: boolean
  onClose: () => void
  templateId: string
}

export function PreviewModal({ open, onClose, templateId }: PreviewModalProps) {
  const elements = useEditorStore(useShallow(selectAllTemplateElements))
  const pages = useEditorStore((s) => s.pages)
  const pageSpec = useEditorStore((s) => s.pageSpec)
  const globalVariableDefinitions = useEditorStore((s) => s.globalVariableDefinitions)
  // Union of (a) keys referenced by any element's text/behaviour bindings and
  // (b) keys declared in the Vars tab. Previously only (a) was considered, so
  // a declared-but-not-yet-bound variable showed "No variables detected" in
  // the preview even though the author clearly wanted a form field for it.
  const keys = useMemo(() => {
    const fromElements = extractVariableKeys(elements)
    const fromDefs = (globalVariableDefinitions ?? [])
      .map((d) => d.key)
      .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
    return Array.from(new Set([...fromElements, ...fromDefs]))
  }, [elements, globalVariableDefinitions])
  const tableKeys = useMemo(() => uniqueTableDataKeys(elements), [elements])
  const scalarKeys = useMemo(() => scalarVariableKeys(keys, tableKeys), [keys, tableKeys])

  const formSectionRef = useRef<HTMLDivElement>(null)

  const [scalars, setScalars] = useState<Record<string, string>>({})
  const [tableRows, setTableRows] = useState<Record<string, Record<string, string>[]>>({})
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pdfSrc, setPdfSrc] = useState<string | null>(null)
  // Overflow banner state — populated after each preview-render by asking
  // the measurement endpoint where iText would clip. Surfaced as a yellow
  // banner above the PDF so the author notices silent clipping immediately.
  const [overflowWarnings, setOverflowWarnings] = useState<Overflow[] | null>(null)

  useEffect(() => {
    if (!open) return
    const preview = useEditorStore.getState().variableValues

    const nextScalars: Record<string, string> = {}
    for (const k of scalarKeys) {
      nextScalars[k] = preview[k] ?? ''
    }
    setScalars(nextScalars)

    const nextTables: Record<string, Record<string, string>[]> = {}
    for (const tk of tableKeys) {
      const cols = getTableColumnsForDataKey(elements, tk)
      const colKeys = cols.map((c) => c.key)
      const raw = preview[tk]?.trim() ? preview[tk]! : defaultSampleTableRowsJson()
      nextTables[tk] = parseTableRowsFromJson(raw, colKeys)
    }
    setTableRows(nextTables)

    setPdfSrc(null)
    setErr(null)
  }, [open, scalarKeys, tableKeys, elements])

  if (!open) return null

  const handleClose = () => {
    if (pdfSrc) URL.revokeObjectURL(pdfSrc)
    setPdfSrc(null)
    onClose()
  }

  const buildData = (): Record<string, unknown> => {
    const data = variableValuesToDataTree(scalars) as Record<string, unknown>
    for (const tk of tableKeys) {
      data[tk] = tableRowsToPayload(tableRows[tk] ?? [])
    }
    return data
  }

  const runGenerate = async () => {
    setLoading(true)
    setErr(null)
    setOverflowWarnings(null)
    try {
      const layoutRec = buildLayoutJson(pages, pageSpec, globalVariableDefinitions) as unknown as Record<
        string,
        unknown
      >
      const dataRec = buildData()
      const blob = await generatePreviewPdf(layoutRec, dataRec)
      setPdfSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(blob)
      })
      // Post-render overflow check — ask the measurement endpoint where
      // iText clipped. Previously this only ran on Commit; a user could
      // stare at a silently-clipped preview PDF with no signal. Now a
      // banner appears above the PDF naming each over-sized element.
      if (pixelParityEnabled()) {
        try {
          const resp = await measureLayout(layoutRec, dataRec as Record<string, unknown>)
          const overflows = findOverflowingElements(layoutRec as unknown as LayoutJson, resp.measurements)
          setOverflowWarnings(overflows.length ? overflows : null)
        } catch {
          /* measurement is a soft-assist — failures don't block the preview */
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setLoading(false)
    }
  }

  const scrollToForm = () => {
    formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/60 p-2 sm:p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="preview-title"
      onClick={handleClose}
    >
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-3 py-2.5 sm:px-4 dark:border-zinc-700">
          <h2 id="preview-title" className="text-base font-semibold text-zinc-900 sm:text-lg dark:text-zinc-100">
            Preview PDF
          </h2>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            onClick={handleClose}
          >
            Close
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 sm:gap-4 sm:p-4 md:flex-row md:items-stretch">
          <PreviewDataPanel
            formSectionRef={formSectionRef}
            scalarKeys={scalarKeys}
            scalars={scalars}
            onScalarChange={(key, value) => setScalars((s) => ({ ...s, [key]: value }))}
            elements={elements}
            tableKeys={tableKeys}
            tableRows={tableRows}
            onTableRowsChange={(dataKey, rows) =>
              setTableRows((t) => ({ ...t, [dataKey]: rows }))
            }
            onTableColumnHeaderChange={(dataKey, colIndex, header) => {
              // Locate the TABLE element bound to this dataKey and rewrite the
              // indexed column's header. The PDF renderer reads
              // col.header for the header row, so this keeps preview-panel
              // edits consistent with what prints. We store the header as a
              // single-run rich doc so downstream `parseContentToRuns` paths
              // continue to work (mixed plain + rich are both accepted, but
              // rich is the canonical shape written by the canvas editor).
              const tableEl = elements.find(
                (e) => e.type === 'TABLE' && e.dataKey === dataKey
              )
              if (!tableEl || !tableEl.columns?.length) return
              const nextCols = tableEl.columns.map((c, i) =>
                i === colIndex
                  ? {
                      ...c,
                      header: header
                        ? serializeRunsToContent([{ type: 'text', text: header }])
                        : serializeRunsToContent([]),
                    }
                  : c
              )
              useEditorStore.getState().updateElement(tableEl.id, { columns: nextCols })
            }}
            onGenerate={() => void runGenerate()}
            loading={loading}
            err={err}
          />
          <div className="relative flex min-h-[min(52vh,420px)] min-w-0 flex-1 flex-col overflow-hidden md:min-h-0">
            {overflowWarnings && overflowWarnings.length > 0 ? (
              <div className="mb-2 shrink-0 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                <div className="font-semibold">
                  Content clipped in PDF ({overflowWarnings.length}
                  {' '}
                  element{overflowWarnings.length === 1 ? '' : 's'})
                </div>
                <div className="mt-0.5 opacity-80">
                  {overflowWarnings
                    .slice(0, 3)
                    .map(
                      (o) =>
                        `${o.elementType ?? 'TEXT'} ${o.elementId.slice(0, 6)} overflows by ${Math.round(o.delta)}pt`
                    )
                    .join(' · ')}
                  {overflowWarnings.length > 3 ? ` · +${overflowWarnings.length - 3} more` : ''}
                </div>
                <div className="mt-1 text-[10px] opacity-70">
                  Grow the box height(s) on canvas to fit the content before committing.
                </div>
              </div>
            ) : null}
            {pdfSrc ? (
              <PdfCustomViewer
                blobUrl={pdfSrc}
                downloadFileName={`preview-${templateId.slice(0, 8)}.pdf`}
              />
            ) : (
              <button
                type="button"
                className="flex h-full min-h-[min(52vh,420px)] w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center transition-colors hover:border-violet-400 hover:bg-violet-50/50 md:min-h-0 dark:border-zinc-600 dark:bg-zinc-800/50 dark:hover:border-violet-500 dark:hover:bg-violet-950/20"
                onClick={scrollToForm}
              >
                <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
                  PDF preview will appear here
                </span>
                <span className="max-w-xs text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                  Fill in the <strong className="font-medium text-zinc-700 dark:text-zinc-300">form</strong>{' '}
                  on the left (no raw JSON), then click{' '}
                  <strong className="font-medium text-violet-700 dark:text-violet-300">Generate PDF</strong>.
                  <span className="mt-2 block text-[11px] text-zinc-400">
                    Tip: click this area to scroll to the data form on small screens.
                  </span>
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
