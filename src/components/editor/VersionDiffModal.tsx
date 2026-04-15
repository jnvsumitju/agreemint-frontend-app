import { useCallback, useEffect, useState } from 'react'
import { fetchVersions } from '../../lib/api'
import { parseLayoutJson, type LayoutJson } from '../../types/layout'
import { diffLayouts, type PageDiff } from '../../lib/layoutDiff'

const DIFF_COLORS: Record<string, string> = {
  added: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-800',
  removed: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/30 dark:text-red-200 dark:border-red-800',
  changed: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-800',
  unchanged: 'bg-zinc-50 text-zinc-500 border-zinc-200 dark:bg-zinc-800/30 dark:text-zinc-400 dark:border-zinc-700',
}

const DIFF_BADGES: Record<string, string> = {
  added: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
  removed: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
  changed: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
  unchanged: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400',
}

export function VersionDiffModal({
  open,
  onClose,
  templateId,
}: {
  open: boolean
  onClose: () => void
  templateId: string
}) {
  const [versions, setVersions] = useState<{ id: string; versionNumber: number; layout?: LayoutJson }[]>([])
  const [versionA, setVersionA] = useState<string>('')
  const [versionB, setVersionB] = useState<string>('')
  const [diff, setDiff] = useState<PageDiff[] | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetchVersions(templateId)
      .then((vs) => {
        const sorted = [...vs].sort((a, b) => a.versionNumber - b.versionNumber)
        setVersions(sorted.map((v) => ({ id: v.id, versionNumber: v.versionNumber })))
        if (sorted.length >= 2) {
          setVersionA(sorted[sorted.length - 2].id)
          setVersionB(sorted[sorted.length - 1].id)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open, templateId])

  const computeDiff = useCallback(() => {
    const a = versions.find((v) => v.id === versionA)
    const b = versions.find((v) => v.id === versionB)
    if (!a?.layout || !b?.layout) {
      setDiff(null)
      return
    }
    const pagesA = parseLayoutJson(a.layout).pages
    const pagesB = parseLayoutJson(b.layout).pages
    setDiff(diffLayouts(pagesA, pagesB))
  }, [versions, versionA, versionB])

  useEffect(() => {
    if (versionA && versionB) computeDiff()
  }, [versionA, versionB, computeDiff])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-600 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Version Diff</h2>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Version selectors */}
        <div className="flex items-center gap-3 border-b border-zinc-200 px-4 py-2 dark:border-zinc-700">
          <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="font-medium">From:</span>
            <select
              className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-800"
              value={versionA}
              onChange={(e) => setVersionA(e.target.value)}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>v{v.versionNumber}</option>
              ))}
            </select>
          </label>
          <span className="text-zinc-400">→</span>
          <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="font-medium">To:</span>
            <select
              className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-800"
              value={versionB}
              onChange={(e) => setVersionB(e.target.value)}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>v{v.versionNumber}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Diff content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && <p className="text-sm text-zinc-500">Loading versions…</p>}
          {!loading && versions.length < 2 && (
            <p className="text-sm text-zinc-500">Need at least 2 committed versions to compare.</p>
          )}
          {diff && diff.map((page) => (
            <div key={page.pageId} className="mb-4">
              <h3 className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                {page.pageName}
                <span className="ml-2 text-[10px] font-normal text-zinc-400">
                  +{page.summary.added} −{page.summary.removed} ~{page.summary.changed}
                </span>
              </h3>
              {page.elements.filter((e) => e.type !== 'unchanged').length === 0 ? (
                <p className="text-[11px] text-zinc-400">No changes on this page.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {page.elements
                    .filter((e) => e.type !== 'unchanged')
                    .map((ed) => (
                      <li
                        key={ed.id}
                        className={`flex items-start gap-2 rounded border p-2 text-[11px] ${DIFF_COLORS[ed.type]}`}
                      >
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${DIFF_BADGES[ed.type]}`}>
                          {ed.type}
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="font-mono text-[10px]">{ed.element.type}</span>
                          <span className="ml-1 text-zinc-500">{ed.id}</span>
                          {ed.changedFields && (
                            <p className="mt-0.5 text-[10px] text-zinc-500">
                              Changed: {ed.changedFields.join(', ')}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
