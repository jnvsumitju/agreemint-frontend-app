import { useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { fetchTemplate, fetchVersions } from '../lib/api'
import { bootstrapEditorFromRemote } from '../lib/templateEditorBootstrap'
import { useEditorStore } from '../stores/editorStore'
import { LeftPalette } from '../components/editor/LeftPalette'
import { EditorCanvas } from '../components/editor/EditorCanvas'
import { PropertiesPanel } from '../components/editor/PropertiesPanel'
import { Toolbar } from '../components/editor/Toolbar'
import { EditorStatusBar } from '../components/editor/EditorStatusBar'

export function TemplateEditor() {
  const { templateId } = useParams<{ templateId: string }>()
  const contextToolbarExemptRef = useRef<HTMLDivElement | null>(null)
  const reset = useEditorStore((s) => s.reset)
  const setTemplateMeta = useEditorStore((s) => s.setTemplateMeta)
  const loadLayout = useEditorStore((s) => s.loadLayout)
  const loadElements = useEditorStore((s) => s.loadElements)
  const setVersionInfo = useEditorStore((s) => s.setVersionInfo)
  const setVariableValue = useEditorStore((s) => s.setVariableValue)

  useEffect(() => {
    if (!templateId) return
    reset()
    let cancelled = false

    ;(async () => {
      try {
        const t = await fetchTemplate(templateId)
        if (cancelled) return
        setTemplateMeta(t.id, t.name)
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
    })()

    return () => {
      cancelled = true
    }
  }, [
    templateId,
    reset,
    setTemplateMeta,
    loadLayout,
    loadElements,
    setVersionInfo,
    setVariableValue,
  ])

  if (!templateId) {
    return <p className="p-6 text-sm text-red-600">Missing template id</p>
  }

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="flex h-screen min-w-0 flex-col overflow-x-hidden bg-zinc-100 dark:bg-zinc-950">
        <Toolbar contextToolbarExemptRef={contextToolbarExemptRef} />
        <div className="flex min-h-0 min-w-0 flex-1">
          <LeftPalette />
          <EditorCanvas exemptFromInlineCommitRef={contextToolbarExemptRef} />
          <PropertiesPanel />
        </div>
        <EditorStatusBar />
      </div>
    </DndProvider>
  )
}
