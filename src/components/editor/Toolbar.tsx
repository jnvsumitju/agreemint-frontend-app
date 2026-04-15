import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { commitDraft, generatePdf, pdfFileUrl, putDraft } from '../../lib/api'
import { buildGenerationDataFromVariableValues } from '../../lib/previewFormData'
import { editorDraftSyncIntervalMs, editorLocalSaveIntervalMs } from '../../lib/editorEnv'
import { snapshotFromEditorState, writeLocalEditorSnapshot } from '../../lib/editorLocalDraft'
import { findElementByIdInDocument } from '../../lib/documentPageMerge'
import { canSubtractPunchHoleSelection } from '../../lib/shapeGeometry'
import { cycleDarkMode, getDarkModePreference, subscribeDarkMode, type DarkModeValue } from '../../lib/darkMode'
import { exportTemplateJson, importTemplateJson } from '../../lib/templateExport'
import { exportElementAsImage } from '../../lib/canvasExport'
import { captureCanvasThumbnail, setTemplateThumbnail } from '../../lib/templateThumbnails'
import { selectAllTemplateElements, useEditorStore } from '../../stores/editorStore'
import {
  IconUndo, IconRedo, IconScissors, IconEye, IconSave,
  IconSun, IconMoon, IconMonitor, IconMoreVertical,
  IconZoomIn, IconZoomOut,
} from './ToolbarIcons'
import { TOOLBAR_ICON_BTN, TOOLBAR_DIVIDER } from './uiClasses'
import { PresenceAvatars } from './PresenceAvatars'
import { PreviewModal } from './PreviewModal'
import { VersionDiffModal } from './VersionDiffModal'
import { ShareModal } from './ShareModal'

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
    `rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors lg:px-2.5 lg:py-1 lg:text-xs ${
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

function InlineTemplateName() {
  const templateId = useEditorStore((s) => s.templateId)
  const templateName = useEditorStore((s) => s.templateName)
  const setTemplateMeta = useEditorStore((s) => s.setTemplateMeta)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = useCallback(() => {
    setDraft(templateName || '')
    setEditing(true)
    requestAnimationFrame(() => inputRef.current?.select())
  }, [templateName])

  const commit = useCallback(() => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== templateName && templateId) {
      setTemplateMeta(templateId, trimmed)
    }
  }, [draft, templateName, templateId, setTemplateMeta])

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        className="min-w-[4rem] max-w-[12rem] truncate rounded border border-violet-400 bg-white px-1 py-0.5 text-[11px] font-semibold text-zinc-900 outline-none focus:ring-1 focus:ring-violet-400 lg:text-sm dark:border-violet-500 dark:bg-zinc-800 dark:text-zinc-100"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }

  return (
    <button
      type="button"
      className="truncate rounded px-1 py-0.5 text-[11px] font-semibold text-zinc-900 hover:bg-zinc-100 lg:text-sm dark:text-zinc-100 dark:hover:bg-zinc-800"
      title="Click to rename"
      onClick={startEdit}
    >
      {templateName || 'Untitled'}
    </button>
  )
}

function VersionBadge({
  versionNumber,
  onCommit,
  saving,
}: {
  versionNumber: number
  onCommit: () => void
  saving: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={ref} className="relative hidden lg:inline-block">
      <button
        type="button"
        className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-200 lg:text-xs dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
        title="Version info"
        onClick={() => setOpen((o) => !o)}
      >
        v{versionNumber}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-[300] mt-1 min-w-[10rem] rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-600 dark:bg-zinc-800">
          <p className="text-[11px] font-medium text-zinc-800 dark:text-zinc-100">
            Version {versionNumber}
          </p>
          <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
            This is the latest committed version. Uncommitted changes are auto-saved as a draft.
          </p>
          <button
            type="button"
            className="mt-2 w-full rounded border border-violet-300 bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-800 hover:bg-violet-100 disabled:opacity-50 dark:border-violet-600 dark:bg-violet-900/40 dark:text-violet-100 dark:hover:bg-violet-900/60"
            disabled={saving}
            onClick={() => {
              onCommit()
              setOpen(false)
            }}
          >
            {saving ? 'Saving…' : 'Commit new version'}
          </button>
        </div>
      )}
    </div>
  )
}

const DARK_MODE_ICONS: Record<DarkModeValue, { icon: React.ReactNode; label: string }> = {
  light: {
    label: 'Light mode — click to switch to dark',
    icon: <IconSun />,
  },
  dark: {
    label: 'Dark mode — click to switch to system',
    icon: <IconMoon />,
  },
  system: {
    label: 'System theme — click to switch to light',
    icon: <IconMonitor />,
  },
}

function DarkModeToggle() {
  const pref = useSyncExternalStore(subscribeDarkMode, getDarkModePreference)
  const { icon, label } = DARK_MODE_ICONS[pref]
  return (
    <button
      type="button"
      className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 lg:h-8 lg:w-8 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
      title={label}
      aria-label={label}
      onClick={() => cycleDarkMode()}
    >
      {icon}
    </button>
  )
}

export function Toolbar() {
  const navigate = useNavigate()
  const templateId = useEditorStore((s) => s.templateId)
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
  const canvasZoom = useEditorStore((s) => s.canvasZoom)
  const setCanvasZoom = useEditorStore((s) => s.setCanvasZoom)
  const viewOnly = useEditorStore((s) => s.viewOnly)
  const setViewOnly = useEditorStore((s) => s.setViewOnly)

  const [saving, setSaving] = useState(false)
  const [generatingVersionPdf, setGeneratingVersionPdf] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [versionDiffOpen, setVersionDiffOpen] = useState(false)

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
      // Capture thumbnail for gallery preview (fire-and-forget)
      captureCanvasThumbnail().then((dataUrl) => {
        if (dataUrl && templateId) setTemplateThumbnail(templateId, dataUrl)
      }).catch(() => { /* non-critical */ })
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
      <header className="flex min-h-[2.25rem] shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-2 py-1 lg:min-h-[2.75rem] lg:gap-4 lg:px-4 lg:py-2 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex min-w-0 shrink-0 items-center gap-1.5 lg:gap-3">
          <button
            type="button"
            className="text-[11px] text-violet-600 hover:underline lg:text-sm dark:text-violet-400"
            onClick={() => navigate('/')}
          >
            Templates
          </button>
          <InlineTemplateName />
          {versionNumber != null && versionNumber > 0 && (
            <VersionBadge versionNumber={versionNumber} onCommit={() => void commitVersion()} saving={saving} />
          )}
        </div>
        <EditorSurfaceSwitcher />
        <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-l border-zinc-200 pl-1.5 lg:pl-3 dark:border-zinc-600">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 lg:h-8 lg:w-8 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
            title="Undo (⌘Z / Ctrl+Z)"
            aria-label="Undo"
            disabled={viewOnly || !canUndo}
            onClick={() => undo()}
          >
            <IconUndo size={18} />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 lg:h-8 lg:w-8 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
            title="Redo (⌘⇧Z / Ctrl+Shift+Z or Ctrl+Y)"
            aria-label="Redo"
            disabled={viewOnly || !canRedo}
            onClick={() => redo()}
          >
            <IconRedo size={18} />
          </button>
          <button
            type="button"
            className="ml-0.5 flex h-8 items-center gap-1 rounded-md border border-transparent px-2 text-xs font-medium text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
            title="Subtract smaller shape from larger (two mergeable shapes, or a group of two)"
            aria-label="Punch hole"
            disabled={viewOnly || !canPunchHole}
            onClick={() => subtractSelectionToMergedShape()}
          >
            <IconScissors />
            <span className="hidden lg:inline">Punch hole</span>
          </button>
        </div>
          <span className={TOOLBAR_DIVIDER} aria-hidden />
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              className={TOOLBAR_ICON_BTN}
              title="Zoom out"
              aria-label="Zoom out"
              onClick={() => setCanvasZoom(Math.max(0.25, Math.round((canvasZoom - 0.1) * 100) / 100))}
            >
              <IconZoomOut size={14} />
            </button>
            <span className="min-w-[2.5rem] select-none text-center text-[11px] tabular-nums text-zinc-600 dark:text-zinc-300">
              {Math.round(canvasZoom * 100)}%
            </span>
            <button
              type="button"
              className={TOOLBAR_ICON_BTN}
              title="Zoom in"
              aria-label="Zoom in"
              onClick={() => setCanvasZoom(Math.min(3, Math.round((canvasZoom + 0.1) * 100) / 100))}
            >
              <IconZoomIn size={14} />
            </button>
          </div>
        <PresenceAvatars />
        <div className="ml-auto flex shrink-0 items-center gap-1.5 lg:gap-2">
          {error && <span className="max-w-xs truncate text-xs text-red-600">{error}</span>}
          <button
            type="button"
            className="flex h-7 items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 lg:h-8 lg:px-3 lg:text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            title="Share template"
            disabled={!templateId}
            onClick={() => setShareOpen(true)}
          >
            <svg className="h-[15px] w-[15px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
            </svg>
            <span className="hidden lg:inline">Share</span>
          </button>
          <button
            type="button"
            className="flex h-7 items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 lg:h-8 lg:px-3 lg:text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            title="Preview PDF from current editor state"
            disabled={!templateId}
            onClick={() => setPreviewOpen(true)}
          >
            <IconEye size={15} />
            <span className="hidden lg:inline">Preview</span>
          </button>
          <button
            type="button"
            className="flex h-7 items-center gap-1 rounded-md border border-violet-300 bg-violet-50 px-2 text-[11px] font-medium text-violet-800 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40 lg:h-8 lg:px-3 lg:text-xs dark:border-violet-600 dark:bg-violet-900/40 dark:text-violet-100 dark:hover:bg-violet-900/60"
            title="Save current draft as a new numbered version"
            disabled={!templateId || saving}
            onClick={() => void commitVersion()}
          >
            <IconSave size={15} />
            <span className="hidden lg:inline">{saving ? 'Saving…' : 'Commit'}</span>
          </button>
          <DarkModeToggle />
          <button
            type="button"
            className={`flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium lg:h-8 lg:px-3 lg:text-xs ${
              viewOnly
                ? 'border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-500 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50'
                : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
            }`}
            title={viewOnly ? 'Switch to Edit mode' : 'Switch to View-only mode (hover elements to comment)'}
            onClick={() => setViewOnly(!viewOnly)}
          >
            {viewOnly ? (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
              </svg>
            )}
            <span className="hidden lg:inline">{viewOnly ? 'Viewing' : 'Editing'}</span>
          </button>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-base leading-none text-zinc-500 hover:bg-zinc-50 lg:h-8 lg:w-8 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="More actions"
              disabled={!templateId || saving || generatingVersionPdf}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <IconMoreVertical />
            </button>
            {menuOpen && templateId ? (
              <div
                className="absolute right-0 z-[300] mt-1 min-w-[11rem] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-600 dark:bg-zinc-800"
                role="menu"
              >
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
                <p className="border-t border-zinc-100 px-3 py-1.5 text-[10px] leading-snug text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  Uses committed layout with current variable values.
                </p>
                <div className="border-t border-zinc-100 dark:border-zinc-700" />
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-700"
                  onClick={() => {
                    const s = useEditorStore.getState()
                    exportTemplateJson(
                      s.pages,
                      s.pageSpec,
                      s.globalVariableDefinitions,
                      s.variableValues,
                      `template-${templateId.slice(0, 8)}.json`
                    )
                    setMenuOpen(false)
                  }}
                >
                  Export JSON
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-700"
                  onClick={() => {
                    const input = document.createElement('input')
                    input.type = 'file'
                    input.accept = '.json'
                    input.onchange = async () => {
                      const file = input.files?.[0]
                      if (!file) return
                      try {
                        const data = await importTemplateJson(file)
                        const s = useEditorStore.getState()
                        s.loadLayout({
                          pages: data.pages,
                          page: data.pageSpec,
                          globalVariables: data.globalVariables,
                        })
                        for (const [k, v] of Object.entries(data.variableValues)) {
                          s.setVariableValue(k, v)
                        }
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Import failed')
                      }
                    }
                    input.click()
                    setMenuOpen(false)
                  }}
                >
                  Import JSON
                </button>
                <div className="border-t border-zinc-100 dark:border-zinc-700" />
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-700"
                  onClick={() => {
                    setVersionDiffOpen(true)
                    setMenuOpen(false)
                  }}
                >
                  Version Diff
                </button>
                <div className="border-t border-zinc-100 dark:border-zinc-700" />
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-700"
                  onClick={() => {
                    const pageEl = document.querySelector<HTMLElement>('[data-agreemint-page-canvas]')
                    if (pageEl) {
                      void exportElementAsImage(pageEl, `template-${templateId!.slice(0, 8)}-page`, 'png')
                    }
                    setMenuOpen(false)
                  }}
                >
                  Export as PNG
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="block w-full px-3 py-2 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-700"
                  onClick={() => {
                    const pageEl = document.querySelector<HTMLElement>('[data-agreemint-page-canvas]')
                    if (pageEl) {
                      void exportElementAsImage(pageEl, `template-${templateId!.slice(0, 8)}-page`, 'jpeg')
                    }
                    setMenuOpen(false)
                  }}
                >
                  Export as JPEG
                </button>
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
      {templateId && (
        <VersionDiffModal
          open={versionDiffOpen}
          onClose={() => setVersionDiffOpen(false)}
          templateId={templateId}
        />
      )}
      {templateId && (
        <ShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          templateId={templateId}
        />
      )}
    </>
  )
}
