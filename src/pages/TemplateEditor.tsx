import { useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { authFetch, fetchTemplate, fetchVersions } from '../lib/api'
import { bootstrapEditorFromRemote } from '../lib/templateEditorBootstrap'
import { connectToTemplate, disconnectFromTemplate } from '../lib/websocket'
import { useEditorStore } from '../stores/editorStore'
import { useFollowMode } from '../hooks/useFollowMode'
import { useThumbnailCapture } from '../hooks/useThumbnailCapture'
import { useCollab } from '../collab/useCollab'
import { EditorShell } from '../components/editor/EditorShell'

export function TemplateEditor() {
  const { templateId } = useParams<{ templateId: string }>()
  const [searchParams] = useSearchParams()
  useFollowMode()
  useCollab(templateId ?? null)
  // Only here, not in EditorShell: the sandbox editor shares the shell and has
  // a synthetic template id that no endpoint would accept.
  useThumbnailCapture(templateId)

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
          // Network-level failure only. Note this does NOT catch an
          // unauthenticated or forbidden response: `authFetch` resolves a 401
          // as a Response rather than throwing, so that path falls out of the
          // `accessRes.ok` check above with none of the setters having run —
          // leaving the fail-closed `viewOnly: true, canEdit: false` from
          // `reset()`. Either way the editor stays read-only, which is the
          // intended fallback.
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

  return <EditorShell />
}
