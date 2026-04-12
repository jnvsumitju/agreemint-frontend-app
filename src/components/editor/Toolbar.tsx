import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { commitDraft, generatePdf, pdfFileUrl, putDraft } from '../../lib/api'
import { buildGenerationDataFromVariableValues } from '../../lib/previewFormData'
import { editorDraftSyncIntervalMs, editorLocalSaveIntervalMs } from '../../lib/editorEnv'
import { snapshotFromEditorState, writeLocalEditorSnapshot } from '../../lib/editorLocalDraft'
import { findElementByIdInDocument } from '../../lib/documentPageMerge'
import { canSubtractPunchHoleSelection } from '../../lib/shapeGeometry'
import { selectAllTemplateElements, useEditorStore } from '../../stores/editorStore'
import { EditorContextToolbar } from './EditorContextToolbar'
import { PreviewModal } from './PreviewModal'

function EditorSurfaceSwitcher() {
  const pages = useEditorStore((s) => s.pages)
  const bandCanvasEditElementId = useEditorStore((s) => s.bandCanvasEditElementId)
  const enterBandCanvasEdit = useEditorStore((s) => s.enterBandCanvasEdit)
  const exitBandCanvasEdit = useEditorStore((s) => s.exitBandCanvasEdit)

  const { headerEl, footerEl, surface } = useMemo(() => {
    const page0 = pages[0]?.elements ?? []
    const header = page0.find((e) => e.type === 'HEADER')
    const footer = page0.find((e) => e.type === 'FOOTER')
    const open = bandCanvasEditElementId
      ? findElementByIdInDocument(pages, bandCanvasEditElementId)
      : null
    const surf: 'page' | 'header' | 'footer' =
      open?.type === 'FOOTER' ? 'footer' : open?.type === 'HEADER' ? 'header' : 'page'
    return { headerEl: header, footerEl: footer, surface: surf }
  }, [pages, bandCanvasEditElementId])

  const tabCls = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
      active
        ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-50'
        : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
    }`

  return (
    <div
      className="ml-2 flex shrink-0 items-center rounded-lg border border-zinc-200 bg-zinc-100/90 p-0.5 dark:border-zinc-600 dark:bg-zinc-800/60"
      role="tablist"
      aria-label="Editor surface"
    >
      <button
        type="button"
        role="tab"
        aria-selected={surface === 'page'}
        className={tabCls(surface === 'page')}
        onClick={() => exitBandCanvasEdit()}
      >
        Page
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={surface === 'header'}
        disabled={!headerEl}
        className={`${tabCls(surface === 'header')} disabled:cursor-not-allowed disabled:opacity-35`}
        title={!headerEl ? 'Add a header on page 1' : 'Edit header'}
        onClick={() => headerEl && enterBandCanvasEdit(headerEl.id)}
      >
        Header
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={surface === 'footer'}
        disabled={!footerEl}
        className={`${tabCls(surface === 'footer')} disabled:cursor-not-allowed disabled:opacity-35`}
        title={!footerEl ? 'Add a footer on page 1' : 'Edit footer'}
        onClick={() => footerEl && enterBandCanvasEdit(footerEl.id)}
      >
        Footer
      </button>
    </div>
  )
}

export function Toolbar({ contextToolbarExemptRef }: { contextToolbarExemptRef: RefObject<HTMLDivElement | null> }) {
  const navigate = useNavigate()
  const templateId = useEditorStore((s) => s.templateId)
  const templateName = useEditorStore((s) => s.templateName)
  const versionNumber = useEditorStore((s) => s.versionNumber)
  const currentVersionId = useEditorStore((s) => s.currentVersionId)
  const setVersionInfo = useEditorStore((s) => s.setVersionInfo)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const subtractSelectionToMergedShape = useEditorStore((s) => s.subtractSelectionToMergedShape)
  const canUndo = useEditorStore((s) => s.undoPast.length > 0)
  const canRedo = useEditorStore((s) => s.undoFuture.length > 0)
  const canPunchHole = useEditorStore((s) =>
    canSubtractPunchHoleSelection({
      selectedIds: s.selectedIds,
      elements: s.pages[s.activePageIndex]?.elements ?? [],
    })
  )

  const [saving, setSaving] = useState(false)
  const [generatingVersionPdf, setGeneratingVersionPdf] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const lastLocalJson = useRef<string>('')
  const lastDraftPayload = useRef<string>('')
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    lastLocalJson.current = ''
    lastDraftPayload.current = ''
  }, [templateId])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  useEffect(() => {
    const tid = templateId
    if (!tid) return
    const ms = editorLocalSaveIntervalMs()
    if (ms <= 0) return
    const id = window.setInterval(() => {
      const s = useEditorStore.getState()
      if (s.templateId !== tid) return
      const snap = snapshotFromEditorState(s)
      const json = JSON.stringify(snap)
      if (json === lastLocalJson.current) return
      lastLocalJson.current = json
      writeLocalEditorSnapshot(tid, snap)
    }, ms)
    return () => window.clearInterval(id)
  }, [templateId])

  useEffect(() => {
    const tid = templateId
    if (!tid) return
    const ms = editorDraftSyncIntervalMs()
    if (ms <= 0) return
    const id = window.setInterval(() => {
      const s = useEditorStore.getState()
      if (s.templateId !== tid) return
      const snap = snapshotFromEditorState(s)
      const payload = JSON.stringify({ l: snap.layout, v: snap.variableValues })
      if (payload === lastDraftPayload.current) return
      lastDraftPayload.current = payload
      void putDraft(tid, snap.layout, snap.variableValues).catch(() => {
        /* offline or server down */
      })
    }, ms)
    return () => window.clearInterval(id)
  }, [templateId])

  const commitVersion = async () => {
    if (!templateId) return
    setSaving(true)
    setError(null)
    try {
      const s = useEditorStore.getState()
      const snap = snapshotFromEditorState(s)
      await putDraft(templateId, snap.layout, snap.variableValues)
      const v = await commitDraft(templateId)
      setVersionInfo(v.id, v.versionNumber)
      lastDraftPayload.current = ''
      setMenuOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Commit failed')
    } finally {
      setSaving(false)
    }
  }

  const generateFromLatestCommitted = async () => {
    if (!templateId || !currentVersionId) return
    setGeneratingVersionPdf(true)
    setError(null)
    setMenuOpen(false)
    try {
      const s = useEditorStore.getState()
      const elements = selectAllTemplateElements(s)
      const data = buildGenerationDataFromVariableValues(elements, s.variableValues)
      const result = await generatePdf(templateId, currentVersionId, data)
      const url = pdfFileUrl(result.fileUrl)
      const res = await fetch(url)
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `template-${templateId.slice(0, 8)}-v${s.versionNumber ?? ''}.pdf`
      a.rel = 'noopener'
      a.click()
      URL.revokeObjectURL(href)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF generation failed')
    } finally {
      setGeneratingVersionPdf(false)
    }
  }

  return (
    <>
      <header className="flex min-h-[2.75rem] shrink-0 items-center gap-4 border-b border-zinc-200 bg-white px-4 py-2 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex min-w-0 shrink-0 items-center gap-3">
          <button
            type="button"
            className="text-sm text-violet-600 hover:underline dark:text-violet-400"
            onClick={() => navigate('/')}
          >
            Templates
          </button>
          <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {templateName || 'Untitled'}
          </span>
          {versionNumber != null && versionNumber > 0 && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              v{versionNumber}
            </span>
          )}
        </div>
        <EditorSurfaceSwitcher />
        <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-l border-zinc-200 pl-3 dark:border-zinc-600">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
            title="Undo (⌘Z / Ctrl+Z)"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={() => undo()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
            </svg>
          </button>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
            title="Redo (⌘⇧Z / Ctrl+Shift+Z or Ctrl+Y)"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={() => redo()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M21 7v6h-6" />
              <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
            </svg>
          </button>
          <button
            type="button"
            className="ml-0.5 flex h-8 items-center gap-1 rounded-md border border-transparent px-2 text-xs font-medium text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
            title="Subtract smaller shape from larger (two mergeable shapes, or a group of two)"
            aria-label="Punch hole"
            disabled={!canPunchHole}
            onClick={() => subtractSelectionToMergedShape()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <rect x="9" y="9" width="6" height="6" rx="1" strokeDasharray="2 1" />
            </svg>
            <span className="hidden lg:inline">Punch hole</span>
          </button>
        </div>
        <EditorContextToolbar containerRef={contextToolbarExemptRef} />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {error && <span className="max-w-xs truncate text-xs text-red-600">{error}</span>}
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300 text-lg leading-none text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="More actions"
              disabled={!templateId || saving || generatingVersionPdf}
              onClick={() => setMenuOpen((o) => !o)}
            >
              ⋮
            </button>
            {menuOpen && templateId ? (
              <div
                className="absolute right-0 z-[300] mt-1 min-w-[11rem] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-600 dark:bg-zinc-800"
                role="menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-700"
                  onClick={() => {
                    setMenuOpen(false)
                    setPreviewOpen(true)
                  }}
                >
                  Preview PDF
                </button>
                <p className="border-b border-zinc-100 px-3 pb-2 text-[10px] leading-snug text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  PDF from current editor state (unsaved changes included).
                </p>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-100 dark:hover:bg-zinc-700"
                  disabled={!currentVersionId || generatingVersionPdf}
                  title={
                    !currentVersionId
                      ? 'Commit a version first'
                      : 'Layout from last committed version; data from current Variables preview'
                  }
                  onClick={() => void generateFromLatestCommitted()}
                >
                  {generatingVersionPdf ? 'Generating…' : 'Generate PDF (latest version)'}
                </button>
                <p className="px-3 pb-2 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
                  Server layout for the version shown in the header; merge fields use your current
                  variable values.
                </p>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-100 dark:hover:bg-zinc-700"
                  disabled={saving}
                  onClick={() => void commitVersion()}
                >
                  {saving ? 'Committing…' : 'Commit version'}
                </button>
                <p className="border-t border-zinc-100 px-3 py-1.5 text-[10px] leading-snug text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  Saves the current draft in the database as a new numbered version.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      {templateId && (
        <PreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          templateId={templateId}
        />
      )}
    </>
  )
}
