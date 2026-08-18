import { useEffect, useRef } from 'react'
import { captureTemplateThumbnail } from '../lib/api'
import { snapshotFromEditorState } from '../lib/editorLocalDraft'
import { thumbnailFingerprint } from '../lib/thumbnailFingerprint'
import { useEditorStore } from '../stores/editorStore'

/** How often to consider re-rendering the preview image, in milliseconds. */
const INTERVAL_MS = 60_000

/**
 * Keep a template's preview image roughly current while someone edits it.
 *
 * <p>Asks the server to re-render, rather than screenshotting the canvas. The
 * canvas is explicitly not pixel-identical to the PDF, so a canvas capture
 * would show a picture of the editor where the list is meant to show a picture
 * of the document. It also means the request body is empty — the server reads
 * the draft the collaborative flush job already persists, so nothing here has
 * to serialise or upload a layout.
 *
 * <p>Change-gated on purpose. Each capture costs a full PDF render plus a
 * rasterise plus an upload, and an editor left open on a document nobody is
 * touching would otherwise pay that every minute for as long as the tab lives.
 * The first tick is exempt: it captures unconditionally, which is what gives a
 * thumbnail to templates committed before any of this existed.
 */
export function useThumbnailCapture(templateId: string | null | undefined): void {
  const fingerprint = useRef<string | null>(null)
  const inFlight = useRef(false)

  useEffect(() => {
    fingerprint.current = null
    inFlight.current = false
  }, [templateId])

  useEffect(() => {
    if (!templateId) return

    const id = window.setInterval(() => {
      const s = useEditorStore.getState()
      // The store is shared and outlives any one editor; a tick that lands
      // after a navigation would otherwise capture one template under the id
      // of another.
      if (s.templateId !== templateId) return
      // The endpoint wants the same roles as editing. A reviewer or viewer
      // would be refused every sixty seconds for the whole time they had the
      // template open.
      if (!s.canEdit) return
      if (inFlight.current) return

      const next = thumbnailFingerprint(snapshotFromEditorState(s))
      if (fingerprint.current === next) return
      fingerprint.current = next

      inFlight.current = true
      void captureTemplateThumbnail(templateId).finally(() => {
        inFlight.current = false
      })
    }, INTERVAL_MS)

    return () => window.clearInterval(id)
  }, [templateId])
}
