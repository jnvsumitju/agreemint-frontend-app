import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Object-URL lifecycle for the inline preview.
 *
 * <p>The modal this replaced had one exit — closing it — and revoked there. An
 * inline pane has three: refreshing (the common action), leaving preview mode,
 * and never explicitly "closing" at all. Every URL that is dropped without
 * being revoked pins its PDF in memory for the life of the tab, and refresh is
 * exactly the button people press repeatedly while fixing a layout.
 *
 * <p>These assert on the create/revoke pairing rather than on rendering,
 * because that is the part with no visible symptom until a session has leaked
 * a dozen documents.
 */

const created: string[] = []
const revoked: string[] = []

vi.mock('../lib/api', () => ({
  generatePreviewPdf: vi.fn(async () => new Blob(['%PDF-1.7'], { type: 'application/pdf' })),
  measureLayout: vi.fn(async () => ({ measurements: {} })),
}))

vi.mock('../lib/features', () => ({ pixelParityEnabled: () => false }))

describe('preview object-URL lifecycle', () => {
  beforeEach(async () => {
    created.length = 0
    revoked.length = 0
    let n = 0
    // jsdom is not in play (the suite runs in node), so URL blob helpers have to
    // be provided. Recording both sides is the whole point of the test.
    globalThis.URL.createObjectURL = vi.fn(() => {
      const url = `blob:preview-${++n}`
      created.push(url)
      return url
    }) as unknown as typeof URL.createObjectURL
    globalThis.URL.revokeObjectURL = vi.fn((url: string) => {
      revoked.push(url)
    }) as unknown as typeof URL.revokeObjectURL

    const { usePreviewStore } = await import('./previewStore')
    usePreviewStore.setState({
      active: false,
      loading: false,
      error: null,
      pdfUrl: null,
      overflows: [],
      stale: false,
    })
  })

  it('revokes the previous PDF when the preview is refreshed', async () => {
    const { usePreviewStore } = await import('./previewStore')
    const s = usePreviewStore.getState()

    await s.generate()
    await usePreviewStore.getState().generate()
    await usePreviewStore.getState().generate()

    expect(created).toHaveLength(3)
    // The first two are superseded; only the one on screen may still be live.
    expect(revoked).toEqual(created.slice(0, 2))
    expect(usePreviewStore.getState().pdfUrl).toBe(created[2])
  })

  it('revokes the live PDF when preview mode is left', async () => {
    const { usePreviewStore } = await import('./previewStore')
    await usePreviewStore.getState().generate()
    expect(revoked).toHaveLength(0)

    usePreviewStore.getState().exit()

    expect(revoked).toEqual(created)
    expect(usePreviewStore.getState().pdfUrl).toBeNull()
  })

  it('clears a render failure rather than leaving the last error on screen', async () => {
    const { usePreviewStore } = await import('./previewStore')
    const api = await import('../lib/api')
    vi.mocked(api.generatePreviewPdf).mockRejectedValueOnce(new Error('boom'))

    await usePreviewStore.getState().generate()
    expect(usePreviewStore.getState().error).toBe('boom')
    expect(usePreviewStore.getState().loading).toBe(false)

    await usePreviewStore.getState().generate()
    expect(usePreviewStore.getState().error).toBeNull()
  })

  it('a successful render is not stale, and exiting resets the flag', async () => {
    const { usePreviewStore } = await import('./previewStore')
    usePreviewStore.setState({ stale: true })

    await usePreviewStore.getState().generate()
    // What is on screen now matches what the editor holds.
    expect(usePreviewStore.getState().stale).toBe(false)

    usePreviewStore.getState().exit()
    expect(usePreviewStore.getState().stale).toBe(false)
  })

  it('marks stale only once a PDF exists to be out of date', async () => {
    const { usePreviewStore } = await import('./previewStore')

    // No render yet: there is nothing for "out of date" to describe, and
    // showing the warning over an empty pane would be nonsense.
    usePreviewStore.getState().markStale()
    expect(usePreviewStore.getState().stale).toBe(false)

    await usePreviewStore.getState().generate()
    usePreviewStore.getState().markStale()
    expect(usePreviewStore.getState().stale).toBe(true)
  })
})
