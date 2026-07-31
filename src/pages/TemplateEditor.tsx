import { useEffect, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { authFetch, fetchTemplate, fetchVersions } from '../lib/api'
import { bootstrapEditorFromRemote } from '../lib/templateEditorBootstrap'
import { connectToTemplate, disconnectFromTemplate } from '../lib/websocket'
import { useEditorStore } from '../stores/editorStore'
import { useFollowMode } from '../hooks/useFollowMode'
import { useCollab } from '../collab/useCollab'
import { LeftPalette } from '../components/editor/LeftPalette'
import { EditorCanvas } from '../components/editor/EditorCanvas'
import { PropertiesPanel } from '../components/editor/PropertiesPanel'
import { Toolbar } from '../components/editor/Toolbar'
import { FormatBar } from '../components/editor/FormatBar'
import { EditorStatusBar } from '../components/editor/EditorStatusBar'
import { ShortcutCheatsheet, useShortcutCheatsheet } from '../components/editor/ShortcutCheatsheet'
import { AiGenerateModal } from '../components/editor/AiGenerateModal'
import { AiGenerationOverlay, AiPendingBar } from '../components/editor/AiGenerationOverlay'
import { FixLayoutBadge } from '../components/editor/FixLayoutBadge'
import { RearrangePagesView } from '../components/editor/RearrangePagesView'
import { AddCommentModal } from '../components/editor/AddCommentModal'

export function TemplateEditor() {
  const { templateId } = useParams<{ templateId: string }>()
  const [searchParams] = useSearchParams()
  const contextToolbarExemptRef = useRef<HTMLDivElement | null>(null)
  const shortcuts = useShortcutCheatsheet()
  useFollowMode()
  useCollab(templateId ?? null)

  // Deep-link support: /editor/{id}?tab=reviews opens the Reviews panel on mount.
  // Used by ReviewsInbox to jump from a notification straight to the review row.
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'reviews' || tab === 'comments' || tab === 'history' || tab === 'activity') {
      useEditorStore.getState().setEditorSidebarTab(tab)
    }
  }, [searchParams])
  const reset = useEditorStore((s) => s.reset)
  const setCanvasZoom = useEditorStore((s) => s.setCanvasZoom)
  const setTemplateMeta = useEditorStore((s) => s.setTemplateMeta)
  const loadLayout = useEditorStore((s) => s.loadLayout)
  const loadElements = useEditorStore((s) => s.loadElements)
  const setVersionInfo = useEditorStore((s) => s.setVersionInfo)
  const setVariableValue = useEditorStore((s) => s.setVariableValue)
  const setViewOnly = useEditorStore((s) => s.setViewOnly)
  const setCanEdit = useEditorStore((s) => s.setCanEdit)
  const setRole = useEditorStore((s) => s.setRole)
  const setLiveMode = useEditorStore((s) => s.setLiveMode)
  const setCommentingEnabled = useEditorStore((s) => s.setCommentingEnabled)

  useEffect(() => {
    if (!templateId) return
    reset()
    let cancelled = false

    ;(async () => {
      try {
        const t = await fetchTemplate(templateId)
        if (cancelled) return
        setTemplateMeta(t.id, t.name)

        // Fetch role FIRST so viewOnly is set before any layout loads
        const KNOWN_ROLES = ['ADMIN', 'DESIGNER', 'REVIEWER', 'VIEWER'] as const
        type KnownRole = typeof KNOWN_ROLES[number]
        let accessRole: KnownRole | null = null
        let accessCanEdit = false
        try {
          const accessRes = await authFetch(`/api/templates/${templateId}/access`)
          if (accessRes.ok && !cancelled) {
            const access = await accessRes.json() as { role: string; canEdit: boolean; canComment: boolean }
            // Narrow the wire-side `string` to our known union via runtime
            // check — direct `as` cast is rejected (string ⇏ string-literal
            // union without overlap). Unknown roles fall back to null so the
            // editor stays in fail-closed mode.
            accessRole = (KNOWN_ROLES as readonly string[]).includes(access.role)
              ? (access.role as KnownRole)
              : null
            accessCanEdit = access.canEdit
            setRole(accessRole)
            setCanEdit(access.canEdit)
            setViewOnly(!access.canEdit)
            setCommentingEnabled(access.canComment)
            // Reviewer/Viewer always start in committed-only mode; the Live
            // toggle in the toolbar lets them opt in. Reset on every load so
            // a previous session's Live state doesn't leak across templates.
            setLiveMode(false)
            if (!access.canEdit) {
              // Read-only defaults — VIEWER/REVIEWER don't need authoring chrome.
              // Toggles in the status bar still let them opt back in.
              useEditorStore.getState().setShowGrid(false)
              useEditorStore.getState().setShowRulers(false)
            }
          }
        } catch {
          // If access endpoint not available (e.g. no auth), default to full edit
        }

        const versions = await fetchVersions(templateId)
        if (cancelled) return
        // Reviewer/Viewer skip the live draft and load the latest committed
        // version directly. The bootstrap respects this via committedOnly.
        const committedOnly = !accessCanEdit && (accessRole === 'REVIEWER' || accessRole === 'VIEWER')
        await bootstrapEditorFromRemote(templateId, versions, {
          loadLayout,
          loadElements,
          setVersionInfo,
          setVariableValue,
        }, { committedOnly })
      } catch {
        if (!cancelled) {
          setTemplateMeta(templateId, 'Unknown template')
          loadElements([])
          setVersionInfo(null, null)
        }
      }
      // Set initial zoom based on viewport width (after layout load resets zoom)
      if (!cancelled) {
        const w = window.innerWidth
        if (w < 1024) setCanvasZoom(0.5)
        else if (w < 1440) setCanvasZoom(0.66)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    templateId,
    reset,
    setCanvasZoom,
    setTemplateMeta,
    loadLayout,
    loadElements,
    setVersionInfo,
    setVariableValue,
    setViewOnly,
    setCanEdit,
    setRole,
    setLiveMode,
    setCommentingEnabled,
  ])

  // WebSocket presence connection lifecycle
  useEffect(() => {
    if (!templateId) return
    connectToTemplate(templateId)
    return () => {
      disconnectFromTemplate()
    }
  }, [templateId])

  if (!templateId) {
    return <p className="p-6 text-sm text-red-600">Missing template id</p>
  }

  return (
    <DndProvider backend={HTML5Backend}>
      <TemplateEditorChrome
        exemptFromInlineCommitRef={contextToolbarExemptRef}
        shortcuts={shortcuts}
      />
    </DndProvider>
  )
}

function TemplateEditorChrome({
  exemptFromInlineCommitRef,
  shortcuts,
}: {
  exemptFromInlineCommitRef: React.RefObject<HTMLDivElement | null>
  shortcuts: ReturnType<typeof useShortcutCheatsheet>
}) {
  // The Rearrange tool collapses the side panels + format bar so the
  // canvas can spread out into a 4-column thumbnail grid (Google Slides
  // sorter-style). Reading the flag here keeps the rest of the chrome
  // unchanged when we're back in normal edit mode.
  const rearrangeMode = useEditorStore((s) => s.rearrangeMode)
  return (
    <div className="flex h-full min-w-0 flex-col overflow-x-hidden bg-zinc-100 dark:bg-zinc-950">
      <Toolbar />
      {!rearrangeMode && (
        <FormatBar contextToolbarExemptRef={exemptFromInlineCommitRef} />
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        {!rearrangeMode && <LeftPalette />}
        {rearrangeMode ? (
          <RearrangePagesView />
        ) : (
          <EditorCanvas exemptFromInlineCommitRef={exemptFromInlineCommitRef} />
        )}
        {!rearrangeMode && <PropertiesPanel />}
      </div>
      <EditorStatusBar />
      <ShortcutCheatsheet open={shortcuts.open} onClose={shortcuts.onClose} />
      <AiGenerateModal />
      <AiGenerationOverlay />
      <AiPendingBar />
      <AddCommentModal />
      {!rearrangeMode && <FixLayoutBadge />}
    </div>
  )
}
