import { create } from 'zustand'
import { generatePreviewPdf, generateSandboxPdf, measureLayout } from '../lib/api'
import { buildLayoutJson, type LayoutJson } from '../types/layout'
import { variableValuesToDataTree } from '../lib/layoutBehaviourResolve'
import { findOverflowingElements, type Overflow } from '../lib/overflowCheck'
import { pixelParityEnabled } from '../lib/features'
import { selectAllTemplateElements, useEditorStore } from './editorStore'
import { getTableColumnsForDataKey, parseTableRowsFromJson, tableRowsToPayload } from '../lib/previewFormData'
import { defaultSampleTableRowsJson, uniqueTableDataKeys } from '../lib/variables'
import { detectTableDataFormatFromJson, parseTableVariableData } from '../lib/tableDataFormat'

/**
 * State for the inline PDF preview.
 *
 * <p>Preview used to be a modal that owned its own copy of the variable values,
 * seeded from the editor store and never written back — two surfaces editing
 * the same data with no way to reconcile them. Inline, the values live in the
 * editor store and this holds only what is genuinely about the *render*: the
 * resulting PDF, what the renderer clipped, and whether that output still
 * reflects the current layout.
 *
 * <p>Regeneration is explicit. Each run costs two API round-trips (render, then
 * measure), so refreshing on every keystroke would be slow and would flicker
 * the document under the cursor. Instead {@link PreviewState.stale} tracks
 * whether anything has changed since the last render, so the pane can say so
 * rather than quietly showing output that no longer matches the editor.
 */
export interface PreviewState {
  /** Preview mode is active: the shell shows the PDF instead of the canvas. */
  active: boolean
  loading: boolean
  error: string | null
  /** Object URL for the rendered PDF, or null before the first render. */
  pdfUrl: string | null
  /** Elements the renderer clipped, listed in full — the left panel shows them. */
  overflows: Overflow[]
  /** True when the layout or values changed after the PDF on screen was made. */
  stale: boolean

  enter: () => void
  exit: () => void
  generate: () => Promise<void>
  /** Render and save one watermarked PDF for a signed-out sandbox visitor. */
  downloadSandbox: () => Promise<void>
  markStale: () => void
}

/** Unsubscribes the editor-store watcher that drives {@link PreviewState.stale}. */
let unwatch: (() => void) | null = null

export const usePreviewStore = create<PreviewState>((set, get) => ({
  active: false,
  loading: false,
  error: null,
  pdfUrl: null,
  overflows: [],
  stale: false,

  enter: () => {
    if (get().active) return
    set({ active: true, stale: true })
    // Watch the inputs that change what the PDF would look like. Without this
    // the pane would keep presenting a stale render as if it were current,
    // which is worse than showing nothing — the whole point of previewing is to
    // trust what you see.
    unwatch?.()
    unwatch = useEditorStore.subscribe((s, prev) => {
      if (
        s.variableValues !== prev.variableValues ||
        s.pages !== prev.pages ||
        s.pageSpec !== prev.pageSpec ||
        s.globalVariableDefinitions !== prev.globalVariableDefinitions
      ) {
        if (usePreviewStore.getState().pdfUrl) set({ stale: true })
      }
    })
  },

  exit: () => {
    unwatch?.()
    unwatch = null
    // Revoke here as well as in generate(): leaving preview is the other way a
    // URL stops being reachable, and a blob nobody revokes is held for the life
    // of the document.
    const { pdfUrl } = get()
    if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    set({ active: false, pdfUrl: null, overflows: [], error: null, stale: false })
  },

  downloadSandbox: async () => {
    // Renders fresh rather than reusing `pdfUrl`: the visitor may never have
    // opened the preview pane, and if they did the layout may have moved on
    // since. Saving a document that does not match what is on screen would be
    // a worse bug than a second render.
    set({ loading: true, error: null })
    try {
      const ed = useEditorStore.getState()
      const layout = buildLayoutJson(
        ed.pages,
        ed.pageSpec,
        ed.globalVariableDefinitions
      ) as unknown as Record<string, unknown>

      const blob = await generateSandboxPdf(layout, buildPreviewData())

      // Same client-side save the authenticated viewer uses — an object URL and
      // a synthetic click. No second round trip, and nothing touches storage.
      const url = URL.createObjectURL(blob)
      try {
        const a = document.createElement('a')
        a.href = url
        a.download = `${ed.templateName || 'document'}.pdf`
        document.body.appendChild(a)
        a.click()
        a.remove()
      } finally {
        // Revoking synchronously after click() is safe: the browser has already
        // taken its reference to the blob by then.
        URL.revokeObjectURL(url)
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Could not generate the PDF' })
    } finally {
      set({ loading: false })
    }
  },

  markStale: () => {
    if (get().pdfUrl) set({ stale: true })
  },

  generate: async () => {
    set({ loading: true, error: null })
    try {
      const ed = useEditorStore.getState()
      const layout = buildLayoutJson(
        ed.pages,
        ed.pageSpec,
        ed.globalVariableDefinitions
      ) as unknown as Record<string, unknown>

      const data = buildPreviewData()
      // A signed-out sandbox visitor has no token to send, so the render
      // goes through the public endpoint instead. Same request body, always
      // watermarked, rate limited per address.
      const blob = ed.sandbox
        ? await generateSandboxPdf(layout, data)
        : await generatePreviewPdf(layout, data)

      set((s) => {
        // Revoke the PREVIOUS url as the new one replaces it. Missing this
        // leaked one PDF per refresh, and refreshing is the common action here.
        if (s.pdfUrl) URL.revokeObjectURL(s.pdfUrl)
        return { pdfUrl: URL.createObjectURL(blob), stale: false }
      })

      // Where the renderer clipped. A soft assist: a measurement failure must
      // not discard a PDF that rendered perfectly well.
      // Skipped in the sandbox, matching EditorCanvas: /api/generate/measure
      // is authenticated, so an anonymous visitor would spend a round trip to
      // be told 401 — and a visitor carrying a STALE refresh token from an old
      // session would send authFetch into a refresh attempt that fails. The
      // cost of skipping is the overflow badges, which is the same trade the
      // canvas already makes here.
      if (!ed.sandbox && pixelParityEnabled()) {
        try {
          const resp = await measureLayout(layout, data)
          set({
            overflows: findOverflowingElements(layout as unknown as LayoutJson, resp.measurements),
          })
        } catch {
          set({ overflows: [] })
        }
      } else {
        set({ overflows: [] })
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Preview failed' })
    } finally {
      set({ loading: false })
    }
  },
}))

/**
 * The render payload: scalar variables as a nested tree, plus one entry per
 * table-bound key.
 *
 * <p>Reads straight from the editor store rather than from a form's local
 * state, so the Preview tab and the Vars tab cannot disagree about what a
 * value is.
 */
export function buildPreviewData(): Record<string, unknown> {
  const ed = useEditorStore.getState()
  const values = ed.variableValues
  const elements = selectAllTemplateElements(ed)
  const tableKeys = uniqueTableDataKeys(elements)

  const scalars: Record<string, string> = {}
  for (const [k, v] of Object.entries(values)) {
    if (!tableKeys.includes(k)) scalars[k] = v
  }
  const data = variableValuesToDataTree(scalars) as Record<string, unknown>

  for (const tk of tableKeys) {
    const raw = values[tk]?.trim() ? values[tk]! : defaultSampleTableRowsJson()

    // Structured tables are forwarded whole, exactly as
    // buildGenerationDataFromVariableValues does.
    //
    // These two builders feed the same renderer and MUST agree. They did not:
    // this one ran every value through parseTableRowsFromJson, which returns a
    // single blank row for a structured object — promptly filtered out below —
    // so the inline preview showed an EMPTY table for one the generated PDF
    // renders in full. The pane whose whole job is "see exactly what the PDF
    // will look like" was the one lying.
    if (detectTableDataFormatFromJson(raw) === 'structured') {
      const tvd = parseTableVariableData(raw)
      if (tvd) {
        data[tk] = tvd
        continue
      }
    }

    const cols = getTableColumnsForDataKey(elements, tk).map((c) => c.key)
    // Blank rows are dropped HERE rather than when the editor saves them: a row
    // the author is still filling in has to survive in the editor, but must not
    // print as an empty line in the document.
    data[tk] = tableRowsToPayload(
      parseTableRowsFromJson(raw, cols).filter((r) =>
        Object.values(r).some((v) => String(v ?? '').trim() !== '')
      )
    )
  }
  return data
}
