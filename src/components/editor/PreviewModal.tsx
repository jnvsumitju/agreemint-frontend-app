import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { generatePreviewPdf } from '../../lib/api'
import { buildLayoutJson } from '../../types/layout'
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
  const keys = useMemo(() => extractVariableKeys(elements), [elements])
  const tableKeys = useMemo(() => uniqueTableDataKeys(elements), [elements])
  const scalarKeys = useMemo(() => scalarVariableKeys(keys, tableKeys), [keys, tableKeys])

  const formSectionRef = useRef<HTMLDivElement>(null)

  const [scalars, setScalars] = useState<Record<string, string>>({})
  const [tableRows, setTableRows] = useState<Record<string, Record<string, string>[]>>({})
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pdfSrc, setPdfSrc] = useState<string | null>(null)

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
    try {
      const layout = buildLayoutJson(pages, pageSpec, globalVariableDefinitions) as unknown as Record<
        string,
        unknown
      >
      const blob = await generatePreviewPdf(layout, buildData())
      setPdfSrc((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(blob)
      })
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
            onGenerate={() => void runGenerate()}
            loading={loading}
            err={err}
          />
          <div className="relative min-h-[min(52vh,420px)] min-w-0 flex-1 overflow-hidden md:min-h-0">
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
