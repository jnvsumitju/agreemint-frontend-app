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
        try {
          const accessRes = await authFetch(`/api/templates/${templateId}/access`)
          if (accessRes.ok && !cancelled) {
            const access = await accessRes.json() as { role: string; canEdit: boolean; canComment: boolean }
            setViewOnly(!access.canEdit)
            setCommentingEnabled(access.canComment)
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
        await bootstrapEditorFromRemote(templateId, versions, {
          loadLayout,
          loadElements,
          setVersionInfo,
          setVariableValue,
        })
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
      <div className="flex h-screen min-w-0 flex-col overflow-x-hidden bg-zinc-100 dark:bg-zinc-950">
        <Toolbar />
        <FormatBar contextToolbarExemptRef={contextToolbarExemptRef} />
        <div className="flex min-h-0 min-w-0 flex-1">
          <LeftPalette />
          <EditorCanvas exemptFromInlineCommitRef={contextToolbarExemptRef} />
          <PropertiesPanel />
        </div>
        <EditorStatusBar />
        <ShortcutCheatsheet open={shortcuts.open} onClose={shortcuts.onClose} />
        <AiGenerateModal />
        <AiGenerationOverlay />
        <AiPendingBar />
      </div>
    </DndProvider>
  )
}
