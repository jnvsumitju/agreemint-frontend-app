import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { commitDraft, dismissReview, fetchDocumentFileBlob, fetchVersions, generatePdf, isReviewBlockError, measureLayout, putDraft, putDraftVariables, reopenReview, type TemplateReviewDto } from '../../lib/api'
import { bootstrapEditorFromRemote } from '../../lib/templateEditorBootstrap'
import { pixelParityEnabled } from '../../lib/features'
import { findOverflowingElements, type Overflow } from '../../lib/overflowCheck'
import { buildGenerationDataFromVariableValues } from '../../lib/previewFormData'
import { editorDraftSyncIntervalMs, editorLocalSaveIntervalMs } from '../../lib/editorEnv'
import { snapshotFromEditorState, writeLocalEditorSnapshot } from '../../lib/editorLocalDraft'
import { findElementByIdInDocument } from '../../lib/documentPageMerge'
import { exportTemplateJson, importTemplateJson } from '../../lib/templateExport'
import { exportElementAsImage } from '../../lib/canvasExport'
import { useCollabConnectionStore, type CollabConnectionStatus } from '../../stores/collabConnectionStore'
import { selectAllTemplateElements, useEditorStore } from '../../stores/editorStore'
import { usePreviewStore } from '../../stores/previewStore'
import { useTrySignUpStore } from '../../stores/trySignUpStore'
import { diffVariableValues } from '../../lib/variablePatch'
import { hasUsedFreePdf, markFreePdfUsed } from '../../lib/sandboxDownload'
import { TEMPLATE_GALLERY_URL } from '../../lib/tryTemplates'
import {
  IconUndo, IconRedo, IconEye, IconSave, IconMoreVertical,
} from './ToolbarIcons'
import { PresenceAvatars } from './PresenceAvatars'
import { VersionDiffModal } from './VersionDiffModal'
import { usePlan } from '../../hooks/usePlan'
import { ShareModal } from './ShareModal'
import { RequestReviewModal } from './RequestReviewModal'
import { DeveloperModal } from './DeveloperModal'

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
  const viewOnly = useEditorStore((s) => s.viewOnly)
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

  if (viewOnly) {
    return (
      <span className="truncate px-1 py-0.5 text-[11px] font-semibold text-zinc-900 lg:text-sm dark:text-zinc-100">
        {templateName || 'Untitled'}
      </span>
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

/**
 * Live-edit websocket health indicator. Wifi-style icon next to the Share
 * button — only shown to users who are actively receiving live edits
 * (ADMIN/DESIGNER always; REVIEWER/VIEWER only with the Live toggle on),
 * since they're the audience for whom "is sync working?" matters. Static
 * read-only viewers don't need it cluttering the bar.
 */
function CollabConnectionIndicator() {
  const status = useCollabConnectionStore((s) => s.status)
  const canEdit = useEditorStore((s) => s.canEdit)
  const liveMode = useEditorStore((s) => s.liveMode)
  const role = useEditorStore((s) => s.role)

  // Hide for users who don't receive live edits (REVIEWER/VIEWER in
  // committed mode) and during the load window before /access resolves.
  if (role === null) return null
  const receivingLiveEdits = canEdit || liveMode
  if (!receivingLiveEdits) return null
  // No active connection attempt — nothing to show.
  if (status === 'idle') return null

  const config = collabIndicatorConfig(status)
  return (
    <div
      role="status"
      aria-label={config.aria}
      title={config.tooltip}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md lg:h-8 lg:w-8 ${config.bg}`}
    >
      <CollabWifiIcon status={status} className={config.fg} />
    </div>
  )
}

function collabIndicatorConfig(status: CollabConnectionStatus): {
  bg: string
  fg: string
  tooltip: string
  aria: string
} {
  switch (status) {
    case 'connected':
      return {
        bg: 'bg-emerald-50 dark:bg-emerald-900/30',
        fg: 'text-emerald-600 dark:text-emerald-300',
        tooltip: 'Connected — your changes are syncing in real time',
        aria: 'Connected',
      }
    case 'connecting':
      return {
        bg: 'bg-amber-50 dark:bg-amber-900/30',
        fg: 'text-amber-600 dark:text-amber-300 animate-pulse',
        tooltip: 'Connecting to live edits…',
        aria: 'Connecting',
      }
    case 'reconnecting':
      return {
        bg: 'bg-amber-50 dark:bg-amber-900/30',
        fg: 'text-amber-600 dark:text-amber-300 animate-pulse',
        tooltip: 'Reconnecting… your changes are saved locally and will sync when reconnected',
        aria: 'Reconnecting',
      }
    case 'disconnected':
    default:
      return {
        bg: 'bg-zinc-100 dark:bg-zinc-800',
        fg: 'text-zinc-500 dark:text-zinc-400',
        tooltip: 'Disconnected — your changes are saved locally and will sync when reconnected',
        aria: 'Disconnected',
      }
  }
}

function CollabWifiIcon({ status, className }: { status: CollabConnectionStatus; className?: string }) {
  // Disconnected gets a slash through the wifi icon; the other states reuse
  // the same arcs so the visual identity stays consistent and only the
  // colour changes.
  return (
    <svg
      className={`h-4 w-4 ${className ?? ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.55a11 11 0 0 1 14 0" />
      <path d="M8.5 16.05a6 6 0 0 1 7 0" />
      <path d="M2 8.82a15 15 0 0 1 20 0" />
      <circle cx="12" cy="20" r="0.75" fill="currentColor" />
      {status === 'disconnected' && <path d="M3 3l18 18" />}
    </svg>
  )
}

/**
 * Reviewer/Viewer-only toggle: flip between the latest *committed* snapshot
 * (default) and the *live* in-flight draft that designers are editing.
 * Hidden for ADMIN/DESIGNER — they're always live and don't need it.
 *
 * Toggling re-bootstraps the editor: switching to Live re-fetches the
 * server draft + opens the gate so collab ops apply; switching back to
 * Committed re-loads versions[0] and closes the gate.
 */
function ReviewerLiveToggle({ templateId }: { templateId: string | null }) {
  const canEdit = useEditorStore((s) => s.canEdit)
  const role = useEditorStore((s) => s.role)
  const liveMode = useEditorStore((s) => s.liveMode)
  const setLiveMode = useEditorStore((s) => s.setLiveMode)
  const loadLayout = useEditorStore((s) => s.loadLayout)
  const loadElements = useEditorStore((s) => s.loadElements)
  const setVersionInfo = useEditorStore((s) => s.setVersionInfo)
  const setVariableValue = useEditorStore((s) => s.setVariableValue)
  const [busy, setBusy] = useState(false)

  // Only REVIEWER/VIEWER see the toggle. Hide for ADMIN/DESIGNER (canEdit=true)
  // and during the brief window before /access has resolved (role=null).
  if (canEdit) return null
  if (role !== 'REVIEWER' && role !== 'VIEWER') return null
  if (!templateId) return null

  const flip = async () => {
    if (busy) return
    const next = !liveMode
    setBusy(true)
    try {
      // Set the flag FIRST so the collab listener unblocks (or re-blocks)
      // before we trigger any reload work.
      setLiveMode(next)
      const versions = await fetchVersions(templateId)
      await bootstrapEditorFromRemote(
        templateId,
        versions,
        { loadLayout, loadElements, setVersionInfo, setVariableValue },
        { committedOnly: !next },
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={liveMode}
      disabled={busy}
      onClick={() => void flip()}
      title={liveMode
        ? 'Showing live edits in real time. Click to switch back to the latest committed version.'
        : 'Showing the latest committed version. Click to follow live edits as the designer types.'}
      className={`flex h-7 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium transition-colors lg:h-7 lg:px-2.5 lg:text-xs ${
        liveMode
          ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-100'
          : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          liveMode ? 'animate-pulse bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-500'
        }`}
      />
      <span className="hidden lg:inline">{liveMode ? 'Live' : 'Committed'}</span>
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

export function Toolbar() {
  const navigate = useNavigate()
  const templateId = useEditorStore((s) => s.templateId)
  const versionNumber = useEditorStore((s) => s.versionNumber)
  const currentVersionId = useEditorStore((s) => s.currentVersionId)
  const setVersionInfo = useEditorStore((s) => s.setVersionInfo)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const canUndo = useEditorStore((s) => s.undoPast.length > 0)
  const canRedo = useEditorStore((s) => s.undoFuture.length > 0)
  const viewOnly = useEditorStore((s) => s.viewOnly)
  const setViewOnly = useEditorStore((s) => s.setViewOnly)
  const canEdit = useEditorStore((s) => s.canEdit)
  // Anonymous try-a-template session: the layout came from a static bundle,
  // `templateId` is synthetic, and there is no session behind any request. Note
  // this cannot be inferred from viewOnly/canEdit — a sandbox visitor is an
  // editor, which is exactly what those two describe.
  const sandbox = useEditorStore((s) => s.sandbox)
  const previewActive = usePreviewStore((s) => s.active)
  const enterPreview = usePreviewStore((s) => s.enter)
  const exitPreview = usePreviewStore((s) => s.exit)
  const downloadSandboxPdf = usePreviewStore((s) => s.downloadSandbox)
  const promptSignUp = useTrySignUpStore((s) => s.promptSignUp)

  const [saving, setSaving] = useState(false)
  const [generatingVersionPdf, setGeneratingVersionPdf] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [versionDiffOpen, setVersionDiffOpen] = useState(false)
  // Version history is Starter and up — the server returns 402 on the
  // single-version endpoint the diff reads from.
  const { atLeast: planAtLeast } = usePlan()
  const hasVersionHistory = planAtLeast('STARTER')
  const [reviewModalOpen, setReviewModalOpen] = useState(false)
  const [developerOpen, setDeveloperOpen] = useState(false)
  const [reviewModalVersion, setReviewModalVersion] = useState<{ id: string; number: number } | null>(null)
  /** Server-returned blockers when a commit hits 409 REVIEW_BLOCK. */
  const [commitBlockers, setCommitBlockers] = useState<TemplateReviewDto[] | null>(null)
  /**
   * Pixel-parity soft-assist — elements whose laid-out height exceeds their
   * authored box height. Populated after a commit attempt so the author sees
   * the problem and can one-click grow the boxes for the next save. Does not
   * block the current commit (that's the soft-assist contract).
   */
  const [overflowWarnings, setOverflowWarnings] = useState<Overflow[] | null>(null)

  const lastLocalJson = useRef<string>('')
  const lastDraftPayload = useRef<string>('')
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const menuContentRef = useRef<HTMLDivElement | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)

  useEffect(() => {
    lastLocalJson.current = ''
    lastDraftPayload.current = ''
  }, [templateId])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      const inTrigger = menuRef.current?.contains(t) ?? false
      const inContent = menuContentRef.current?.contains(t) ?? false
      if (!inTrigger && !inContent) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  // Position the portal-rendered menu relative to the trigger. Fixed positioning
  // via a portal to document.body lets the menu paint above the right sidebar
  // tabs which live in a sibling stacking context.
  useLayoutEffect(() => {
    if (!menuOpen || !menuTriggerRef.current) return
    const update = () => {
      const rect = menuTriggerRef.current?.getBoundingClientRect()
      if (!rect) return
      setMenuPos({
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [menuOpen])

  useEffect(() => {
    const tid = templateId
    if (!tid) return
    // A sandbox session keys this by a synthetic `try:` id and writes a
    // snapshot the real editor would later try to reconcile against a server
    // draft that does not exist. TryTemplateEditor persists its own draft.
    if (sandbox) return
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
  }, [templateId, sandbox])

  // Legacy per-client draft sync — replaced by the collaborative-editor flow in
  // src/collab/*. Ops flow via STOMP; the backend CollabFlushJob persists the hot
  // Redis layout to Postgres every 5s. See plan "Collaborative Editor".
  //
  // Kept behind an env flag as a fallback if the collab path is ever disabled:
  // set VITE_EDITOR_DRAFT_SYNC_MS > 0 to re-enable. With the collab path active
  // the two would race and the older snapshot would clobber remote ops — leave
  // disabled unless you have a reason.
  useEffect(() => {
    const tid = templateId
    if (!tid) return
    if (sandbox) return
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
  }, [templateId, sandbox])

  // Variable-values debounced persist.
  //
  // The collab op stream carries layout changes + variable DEFINITIONS, but
  // not variable VALUES — so typed preview data (table body cells, list
  // items, scalar placeholders) lived only in client memory. On refresh the
  // bootstrap hydrated from the server draft, which never received these
  // edits, so body-cell text disappeared.
  //
  // We debounce 800 ms and PUT only to the draft-variables endpoint, which
  // preserves the collab-flushed layoutJson — no race with CollabFlushJob.
  useEffect(() => {
    const tid = templateId
    if (!tid) return
    // The easiest gate in this file to miss: no button starts this, it just
    // fires 800ms after any variable edit. In a sandbox session there is no
    // draft on the server and no session to authenticate with, so every one of
    // those PUTs would be a 401 — and a 401 with a stale refresh token in
    // localStorage triggers authFetch's logout-and-redirect, throwing away the
    // visitor's unsaved work.
    if (sandbox) return
    let lastSaved = JSON.stringify(useEditorStore.getState().variableValues)
    let timer: number | null = null
    const flush = () => {
      timer = null
      const s = useEditorStore.getState()
      if (s.templateId !== tid) return
      const current = JSON.stringify(s.variableValues)
      if (current === lastSaved) return

      // Diff against what we last successfully sent, so this PUT asserts only
      // the keys THIS editor touched. Sending the whole map made every save
      // clobber a collaborator's unrelated edit.
      const patch = diffVariableValues(
        JSON.parse(lastSaved) as Record<string, string>,
        s.variableValues
      )
      if (Object.keys(patch.set).length === 0 && patch.remove.length === 0) return

      const attempted = current
      void putDraftVariables(tid, patch)
        .then(() => {
          // Advance the baseline only on success. Updating it optimistically
          // would drop this change from the next diff, so a failed request
          // would lose the edit permanently rather than retrying it.
          lastSaved = attempted
        })
        .catch(() => {
          /* offline or server down — the next change re-diffs from the old
             baseline and carries this one along with it */
        })
    }
    const unsubscribe = useEditorStore.subscribe((state, prev) => {
      if (state.templateId !== tid) return
      if (state.variableValues === prev.variableValues) return
      if (timer != null) window.clearTimeout(timer)
      timer = window.setTimeout(flush, 800)
    })
    return () => {
      unsubscribe()
      if (timer != null) window.clearTimeout(timer)
    }
  }, [templateId, sandbox])

  const commitVersion = async () => {
    if (!templateId) return
    // Backstop for the sandbox. The Commit button already routes to the
    // sign-up prompt, but this function is also reachable from VersionBadge
    // and from the keyboard shortcut, and a synthetic templateId passes the
    // check above.
    if (sandbox) {
      promptSignUp('save')
      return
    }
    setSaving(true)
    setError(null)
    setCommitBlockers(null)
    setOverflowWarnings(null)
    try {
      const s = useEditorStore.getState()
      const snap = snapshotFromEditorState(s)

      // Pixel-parity soft-assist: ask the backend measurement endpoint for the
      // height iText will consume for every text element. If the authored box
      // is smaller, the PDF will clip — flag it after the save completes so
      // the author can one-click grow the boxes. We deliberately don't block
      // the save (that's the "soft" part); the warning stays visible until
      // the next successful commit without overflow.
      let pendingOverflows: Overflow[] | null = null
      if (pixelParityEnabled()) {
        try {
          // `snap.layout` is typed as Record<string, unknown> for wire-format
          // parity with the local-draft store; we re-widen here to match the
          // LayoutJson shape findOverflowingElements walks.
          const layoutForCheck = snap.layout as unknown as import('../../types/layout').LayoutJson
          const resp = await measureLayout(
            snap.layout,
            snap.variableValues as unknown as Record<string, unknown>,
          )
          const overflows = findOverflowingElements(layoutForCheck, resp.measurements)
          if (overflows.length > 0) pendingOverflows = overflows
        } catch (measureErr) {
          // Measurement failures are non-fatal — the canvas preview is still
          // a useful check, so we proceed with the save and skip the warning.
          console.warn('Pixel-parity measurement failed; saving without overflow check', measureErr)
        }
      }

      await putDraft(templateId, snap.layout, snap.variableValues)
      const v = await commitDraft(templateId)
      setVersionInfo(v.id, v.versionNumber)
      lastDraftPayload.current = ''
      setMenuOpen(false)
      if (pendingOverflows) setOverflowWarnings(pendingOverflows)
      // No thumbnail capture here any more: the server renders one from the
      // committed layout inside commitDraft. Capturing the canvas at this point
      // recorded a picture of the editor, which is not what the PDF looks like.
      // Prompt to request review from someone on the new version.
      setReviewModalVersion({ id: v.id, number: v.versionNumber })
      setReviewModalOpen(true)
    } catch (e) {
      // Mandatory changes from a prior reviewer → surface blockers UI; designer
      // addresses by reopening (→ PENDING) or dismissing each blocking review.
      if (isReviewBlockError(e)) {
        setCommitBlockers(e.payload.blockers)
        setError(null)
      } else {
        setError(e instanceof Error ? e.message : 'Commit failed')
      }
    } finally {
      setSaving(false)
    }
  }

  // Stay in sync with blocker list as the designer resolves them one by one.
  const handleDismissBlocker = useCallback(async (review: TemplateReviewDto) => {
    if (!templateId) return
    try {
      await dismissReview(templateId, review.id)
      setCommitBlockers((prev) => (prev ?? []).filter((r) => r.id !== review.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dismiss failed')
    }
  }, [templateId])

  const handleReopenBlocker = useCallback(async (review: TemplateReviewDto) => {
    if (!templateId) return
    try {
      await reopenReview(templateId, review.id)
      setCommitBlockers((prev) => (prev ?? []).filter((r) => r.id !== review.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reopen failed')
    }
  }, [templateId])

  /**
   * Soft-assist "Grow to fit" action. Walks every flagged overflow and expands
   * the element's height to the measured value + 2pt breathing room. The next
   * commit then ships the resized boxes without overflow.
   */
  const growOverflowingBoxes = useCallback(() => {
    if (!overflowWarnings || overflowWarnings.length === 0) return
    const store = useEditorStore.getState()
    for (const o of overflowWarnings) {
      store.updateElement(o.elementId, { height: Math.ceil(o.measuredHeight + 2) })
    }
    setOverflowWarnings(null)
  }, [overflowWarnings])

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
      // authFetch under the hood — raw fetch would drop the Bearer token and
      // the backend 401s (the `/file` endpoint streams R2 bytes behind JWT).
      const blob = await fetchDocumentFileBlob(result.fileUrl)
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
      <header className="flex min-h-[2.25rem] shrink-0 items-center gap-2 border-b border-zinc-200 bg-white/90 px-2 py-1 backdrop-blur-sm lg:min-h-[2.75rem] lg:gap-4 lg:px-4 lg:py-2 dark:border-zinc-700/50 dark:bg-zinc-900/95">
        <div className="flex min-w-0 shrink-0 items-center gap-1.5 lg:gap-3">
          <button
            type="button"
            className="text-[11px] text-violet-600 hover:underline lg:text-sm dark:text-violet-400"
            // `/templates` is behind ProtectedRoute, so for a signed-out
            // visitor it is a one-way trip to /login with their work left
            // behind. Send them to the public gallery instead.
            onClick={() => {
              if (sandbox) window.location.href = TEMPLATE_GALLERY_URL
              else navigate('/templates')
            }}
          >
            Templates
          </button>
          <InlineTemplateName />
          {versionNumber != null && versionNumber > 0 && (
            <VersionBadge versionNumber={versionNumber} onCommit={() => void commitVersion()} saving={saving} />
          )}
          <ReviewerLiveToggle templateId={templateId} />
        </div>
        {/* Page / Header / Footer picks which band the canvas edits, and the
            canvas is not on screen while previewing. */}
        {!viewOnly && !previewActive && <EditorSurfaceSwitcher />}
        {/* Undo/redo walk the layout's edit history; there is nothing to undo
            about a rendered document. */}
        {!viewOnly && !previewActive && (
        <div className="flex shrink-0 flex-wrap items-center gap-0.5 border-l border-zinc-200 pl-1.5 lg:pl-3 dark:border-zinc-600">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 lg:h-8 lg:w-8 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
            title="Undo (⌘Z / Ctrl+Z)"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={() => undo()}
          >
            <IconUndo size={18} />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 lg:h-8 lg:w-8 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
            title="Redo (⌘⇧Z / Ctrl+Shift+Z or Ctrl+Y)"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={() => redo()}
          >
            <IconRedo size={18} />
          </button>
          {/* "Punch hole" lives in the left palette's ACTIONS section —
              the duplicate toolbar button was removed to declutter. */}
        </div>
        )}
        {/* Zoom controls live in the EditorStatusBar (bottom bar) now — the
            duplicate topbar pair was removed to declutter. */}
        <PresenceAvatars />
        <div className="ml-auto flex shrink-0 items-center gap-1.5 lg:gap-2">
          {error && <span className="max-w-xs truncate text-xs text-red-600">{error}</span>}
          {overflowWarnings && overflowWarnings.length > 0 && (
            <span
              className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800 dark:border-amber-600/60 dark:bg-amber-900/30 dark:text-amber-200"
              title={overflowWarnings.map((o) => `${o.elementId}: +${o.delta.toFixed(1)}pt`).join('\n')}
            >
              {overflowWarnings.length} text box{overflowWarnings.length === 1 ? '' : 'es'} clipped in PDF
              <button
                type="button"
                className="rounded border border-amber-400 bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium hover:bg-amber-200 dark:border-amber-500 dark:bg-amber-800/50 dark:hover:bg-amber-700/50"
                onClick={growOverflowingBoxes}
              >
                Grow to fit
              </button>
              <button
                type="button"
                aria-label="Dismiss overflow warning"
                className="text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
                onClick={() => setOverflowWarnings(null)}
              >
                ×
              </button>
            </span>
          )}
          <CollabConnectionIndicator />
          {!viewOnly && !sandbox && (
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
          )}
          <button
            type="button"
            className="flex h-7 items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 lg:h-8 lg:px-3 lg:text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            title={
              sandbox
                ? 'Preview the PDF — free, watermarked'
                : 'Preview PDF from current editor state'
            }
            disabled={!templateId}
            // No longer a sign-up wall. A signed-out visitor arrives here from
            // a crixaa.com page whose search result promised "edit and download
            // free", so being stopped at the moment of intent was the worst
            // possible place to ask for an account. The render goes through the
            // public endpoint, which always watermarks and is rate limited per
            // address; the account is what removes the watermark.
            onClick={() => {
              previewActive ? exitPreview() : enterPreview()
            }}
          >
            <IconEye size={15} />
            <span className="hidden lg:inline">{previewActive ? 'Back to editing' : 'Preview'}</span>
          </button>
          {!viewOnly && (
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-md border border-violet-300 bg-violet-50 px-2 text-[11px] font-medium text-violet-800 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40 lg:h-8 lg:px-3 lg:text-xs dark:border-violet-600 dark:bg-violet-900/40 dark:text-violet-100 dark:hover:bg-violet-900/60"
              title={sandbox ? 'Sign up to save this template' : 'Save current draft as a new numbered version'}
              disabled={!templateId || saving}
              onClick={() => (sandbox ? promptSignUp('save') : void commitVersion())}
            >
              <IconSave size={15} />
              <span className="hidden lg:inline">
                {sandbox ? 'Save' : saving ? 'Saving…' : 'Commit'}
              </span>
            </button>
          )}
          {/* Dark-mode toggle lives in Settings → Preferences — the
              duplicate toolbar button was removed to declutter. */}
          {/* Editing/View-only toggle is shown to anyone WITH edit
              permission (canEdit), independent of the current display
              mode. ADMIN/DESIGNER can therefore flip back to edit mode
              after switching to view-only. REVIEWER/VIEWER never see
              the toggle since canEdit is false for them. */}
          {/* Editing vs View-only are both ways of showing the CANVAS. Offering
              the choice over a PDF would suggest the preview itself is editable. */}
          {canEdit && !previewActive && (
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 lg:h-8 lg:px-3 lg:text-xs dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              title={
                viewOnly
                  ? 'Switch back to Editing mode'
                  : 'Switch to View-only mode (hover elements to comment)'
              }
              onClick={() => setViewOnly(!viewOnly)}
            >
              {viewOnly ? (
                // Eye icon while in view-only — clicking restores the pencil/editing mode.
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
              )}
              <span className="hidden lg:inline">{viewOnly ? 'View-only' : 'Editing'}</span>
            </button>
          )}
          <div className="relative" ref={menuRef}>
            <button
              ref={menuTriggerRef}
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
            {menuOpen && templateId && menuPos ? createPortal(
              <div
                ref={menuContentRef}
                className="fixed z-[9999] min-w-[11rem] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-600 dark:bg-zinc-800"
                style={{ top: menuPos.top, right: menuPos.right }}
                role="menu"
              >
                {sandbox ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full px-3 py-2 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-700"
                    // One free watermarked PDF, then the wall. `hasUsedFreePdf`
                    // is a localStorage flag and defeating it is trivial — see
                    // the note in lib/sandboxDownload.ts. It is a courtesy for
                    // an ordinary visitor, and the per-IP limit on the render
                    // endpoint is what actually bounds cost.
                    onClick={() => {
                      setMenuOpen(false)
                      if (hasUsedFreePdf()) {
                        promptSignUp('download')
                        return
                      }
                      markFreePdfUsed()
                      void downloadSandboxPdf()
                    }}
                  >
                    {hasUsedFreePdf() ? 'Download PDF' : 'Download PDF — free'}
                  </button>
                ) : (
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
                )}
                <p className="border-t border-zinc-100 px-3 py-1.5 text-[10px] leading-snug text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  {sandbox
                    ? hasUsedFreePdf()
                      ? 'Create a free account to generate more.'
                      : 'One free PDF, watermarked. An account removes the mark.'
                    : 'Uses committed layout with current variable values.'}
                </p>
                {!viewOnly && (
                  <>
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
                  </>
                )}
                {/* Version Diff and Developer are hidden outright in a sandbox
                    session: there are no versions to diff, and Developer opens
                    onto API keys and org settings that do not exist yet. Both
                    upsell branches also navigate to /settings, which is behind
                    ProtectedRoute. */}
                {!sandbox && <div className="border-t border-zinc-100 dark:border-zinc-700" />}
                {sandbox ? null : !hasVersionHistory ? (
                  <button
                    type="button"
                    role="menuitem"
                    title="Available on Starter and above"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-zinc-400 hover:bg-zinc-100 dark:text-zinc-500 dark:hover:bg-zinc-700"
                    onClick={() => {
                      setMenuOpen(false)
                      navigate('/settings?tab=billing')
                    }}
                  >
                    Version Diff
                    <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                      STARTER
                    </span>
                  </button>
                ) : (
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
                )}
                {!sandbox && (
                  <button
                    type="button"
                    role="menuitem"
                    className="block w-full px-3 py-2 text-left text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-700"
                    onClick={() => {
                      setDeveloperOpen(true)
                      setMenuOpen(false)
                    }}
                  >
                    Developer
                  </button>
                )}
                {!viewOnly && (
                  <>
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
                  </>
                )}
              </div>,
              document.body,
            ) : null}
          </div>
        </div>
      </header>
      {/* All four are gated on `!sandbox` as well as `templateId`. The id alone
          is not enough any more: a try-session has a synthetic one, so these
          would mount against a template that does not exist server-side. Their
          triggers are already hidden or redirected above — this is the second
          line, so a future edit that re-exposes a trigger cannot quietly start
          issuing authenticated requests from an anonymous page. */}
      {templateId && !sandbox && (
        <VersionDiffModal
          open={versionDiffOpen}
          onClose={() => setVersionDiffOpen(false)}
          templateId={templateId}
        />
      )}
      {templateId && !sandbox && (
        <ShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          templateId={templateId}
        />
      )}
      {templateId && !sandbox && reviewModalOpen && (
        <RequestReviewModal
          open={reviewModalOpen}
          onClose={() => setReviewModalOpen(false)}
          templateId={templateId}
          versionId={reviewModalVersion?.id ?? null}
          versionNumber={reviewModalVersion?.number ?? null}
        />
      )}
      {!sandbox && <DeveloperModal open={developerOpen} onClose={() => setDeveloperOpen(false)} />}
      {commitBlockers && commitBlockers.length > 0 && (
        <CommitBlockerBanner
          blockers={commitBlockers}
          onClose={() => setCommitBlockers(null)}
          onDismiss={handleDismissBlocker}
          onReopen={handleReopenBlocker}
        />
      )}
    </>
  )
}

/**
 * Floating banner that appears when `POST /draft/commit` returns 409 REVIEW_BLOCK.
 * Lists each blocking review and lets the designer dismiss or reopen per-row.
 * Fixed-position so the Toolbar's own stacking context doesn't clip it.
 */
function CommitBlockerBanner({
  blockers,
  onClose,
  onDismiss,
  onReopen,
}: {
  blockers: TemplateReviewDto[]
  onClose: () => void
  onDismiss: (r: TemplateReviewDto) => void
  onReopen: (r: TemplateReviewDto) => void
}) {
  return (
    <div className="fixed inset-x-0 top-16 z-[9999] mx-auto w-[min(640px,90vw)] rounded-xl border border-red-200 bg-white p-4 shadow-xl dark:border-red-900/60 dark:bg-zinc-900">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Can't commit: mandatory changes requested
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Address the feedback (reopen to re-review) or dismiss each blocking review to commit again.
          </p>
          <div className="mt-3 space-y-1.5">
            {blockers.map((b) => (
              <div key={b.id} className="flex items-center gap-2 rounded border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-700">
                <span className="truncate font-medium text-zinc-800 dark:text-zinc-100">
                  {b.reviewer.name || b.reviewer.email}
                </span>
                {b.summary && (
                  <span className="truncate text-zinc-500 dark:text-zinc-400">— {b.summary}</span>
                )}
                <div className="ml-auto flex gap-1">
                  <button
                    type="button"
                    className="rounded border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    onClick={() => onReopen(b)}
                  >
                    Re-request review
                  </button>
                  <button
                    type="button"
                    className="rounded border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    onClick={() => onDismiss(b)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
