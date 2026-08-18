import { useRef } from 'react'
import { DndProvider } from 'react-dnd'
import { HTML5Backend } from 'react-dnd-html5-backend'
import { useEditorStore } from '../../stores/editorStore'
import { LeftPalette } from './LeftPalette'
import { EditorCanvas } from './EditorCanvas'
import { PropertiesPanel } from './PropertiesPanel'
import { PreviewPane } from './PreviewPane'
import { PreviewIssuesPanel } from './PreviewIssuesPanel'
import { usePreviewStore } from '../../stores/previewStore'
import { Toolbar } from './Toolbar'
import { FormatBar } from './FormatBar'
import { EditorStatusBar } from './EditorStatusBar'
import { ShortcutCheatsheet, useShortcutCheatsheet } from './ShortcutCheatsheet'
import { AiGenerateModal } from './AiGenerateModal'
import { AiGenerationOverlay, AiPendingBar } from './AiGenerationOverlay'
import { RearrangePagesView } from './RearrangePagesView'
import { AddCommentModal } from './AddCommentModal'

/**
 * Every piece of editor chrome, driven entirely by the editor store.
 *
 * <p>Two pages mount this: `TemplateEditor` (`/editor/:templateId`, which
 * fetches a real template and joins the collab session) and
 * `TryTemplateEditor` (`/try/:slug`, which loads a static bundle and talks to
 * nothing). They differ only in how the store gets populated, so that is all
 * that lives in the pages — this shell is shared verbatim.
 *
 * <p>It lives in its own module rather than being exported from
 * `TemplateEditor` so the two lazily-loaded route chunks stay disjoint. If the
 * try page imported the shell *through* `TemplateEditor`, it would pull in
 * `api.ts`, `websocket.ts` and `useCollab` — the exact code the sandbox is
 * built to never call.
 */
export function EditorShell() {
  const contextToolbarExemptRef = useRef<HTMLDivElement | null>(null)
  const shortcuts = useShortcutCheatsheet()

  return (
    <DndProvider backend={HTML5Backend}>
      <EditorChrome exemptFromInlineCommitRef={contextToolbarExemptRef} shortcuts={shortcuts} />
    </DndProvider>
  )
}

function EditorChrome({
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
  const previewActive = usePreviewStore((s) => s.active)
  return (
    <div className="flex h-full min-w-0 flex-col overflow-x-hidden bg-zinc-100 dark:bg-zinc-950">
      <Toolbar />
      {/* The format bar acts on the current canvas selection, and previewing
          has no selection to format — it only ever read "Select an element to
          format it". */}
      {!rearrangeMode && !previewActive && (
        <FormatBar contextToolbarExemptRef={exemptFromInlineCommitRef} />
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        {/* Previewing swaps the two working surfaces: the left palette's insert
            tools cannot act on a rendered PDF, so that space goes to the list of
            what the renderer clipped, and the centre shows the document itself.
            The properties panel stays — its Values tab is how you change what
            the preview renders. */}
        {!rearrangeMode && (previewActive ? <PreviewIssuesPanel /> : <LeftPalette />)}
        {rearrangeMode ? (
          <RearrangePagesView />
        ) : previewActive ? (
          <PreviewPane />
        ) : (
          <EditorCanvas exemptFromInlineCommitRef={exemptFromInlineCommitRef} />
        )}
        {!rearrangeMode && <PropertiesPanel />}
      </div>
      {/* Zoom, margins, rulers and grid all act on the canvas, which is not on
          screen while previewing — and the PDF has its own zoom and page
          controls. Keeping the bar would offer a second, non-functioning set. */}
      {!previewActive && <EditorStatusBar />}
      <ShortcutCheatsheet open={shortcuts.open} onClose={shortcuts.onClose} />
      <AiGenerateModal />
      <AiGenerationOverlay />
      <AiPendingBar />
      <AddCommentModal />
    </div>
  )
}
