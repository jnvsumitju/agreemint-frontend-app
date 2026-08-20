import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which render endpoint the sandbox uses, and what it must not call.
 *
 * <p>A signed-out visitor has no token. Sending their render to the
 * authenticated endpoint would 401; sending it to the authenticated endpoint
 * with a STALE refresh token left over from an old session is worse, because
 * `authFetch` would try to refresh, fail, and log them out — discarding the
 * document they came to make. So the routing decision here is not a preference,
 * and it has no visible symptom when it regresses: the preview simply stops
 * working for exactly the visitors it was built for.
 */

vi.mock('../lib/api', () => ({
  generatePreviewPdf: vi.fn(async () => new Blob(['%PDF-1.7 clean'], { type: 'application/pdf' })),
  generateSandboxPdf: vi.fn(async () => new Blob(['%PDF-1.7 watermarked'], { type: 'application/pdf' })),
  measureLayout: vi.fn(async () => ({ measurements: {} })),
}))

// Pixel parity ON, so a sandbox render that wrongly calls measureLayout is
// caught. With it off the assertion would pass for the wrong reason.
vi.mock('../lib/features', () => ({ pixelParityEnabled: () => true }))

describe('sandbox rendering', () => {
  beforeEach(async () => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x') as unknown as typeof URL.createObjectURL
    globalThis.URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
    vi.clearAllMocks()

    const { usePreviewStore } = await import('./previewStore')
    usePreviewStore.setState({ active: false, loading: false, error: null, pdfUrl: null, overflows: [], stale: false })
  })

  async function setSandbox(on: boolean) {
    const { useEditorStore } = await import('./editorStore')
    useEditorStore.setState({ sandbox: on })
  }

  it('a signed-out visitor renders through the public endpoint', async () => {
    await setSandbox(true)
    const api = await import('../lib/api')
    const { usePreviewStore } = await import('./previewStore')

    await usePreviewStore.getState().generate()

    expect(api.generateSandboxPdf).toHaveBeenCalledTimes(1)
    expect(api.generatePreviewPdf).not.toHaveBeenCalled()
  })

  it('an authenticated user still renders through the authenticated endpoint', async () => {
    await setSandbox(false)
    const api = await import('../lib/api')
    const { usePreviewStore } = await import('./previewStore')

    await usePreviewStore.getState().generate()

    expect(api.generatePreviewPdf).toHaveBeenCalledTimes(1)
    expect(api.generateSandboxPdf).not.toHaveBeenCalled()
  })

  it('the sandbox never calls the authenticated measure endpoint', async () => {
    await setSandbox(true)
    const api = await import('../lib/api')
    const { usePreviewStore } = await import('./previewStore')

    await usePreviewStore.getState().generate()

    // Pixel parity is enabled above, so this would fire if the guard were gone.
    expect(api.measureLayout).not.toHaveBeenCalled()
  })

  it('measure still runs for an authenticated user', async () => {
    await setSandbox(false)
    const api = await import('../lib/api')
    const { usePreviewStore } = await import('./previewStore')

    await usePreviewStore.getState().generate()

    expect(api.measureLayout).toHaveBeenCalledTimes(1)
  })

  it('the free download renders fresh rather than reusing what is on screen', async () => {
    await setSandbox(true)
    const api = await import('../lib/api')
    const { usePreviewStore } = await import('./previewStore')

    // Pretend a preview is already open and then download.
    await usePreviewStore.getState().generate()
    vi.mocked(api.generateSandboxPdf).mockClear()

    // The suite runs in node, not jsdom, so the anchor the save path builds
    // has to be supplied. Only click() is asserted on — the rest is scaffolding.
    const click = vi.fn()
    const anchor: Record<string, unknown> = { click, remove: vi.fn() }
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { appendChild: vi.fn() },
    })

    await usePreviewStore.getState().downloadSandbox()

    // A fresh render: the layout may have moved on since the preview was made,
    // and saving something that does not match the screen is worse than a
    // second round trip.
    expect(api.generateSandboxPdf).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('surfaces a rate-limit message instead of failing silently', async () => {
    await setSandbox(true)
    const api = await import('../lib/api')
    const { usePreviewStore } = await import('./previewStore')
    vi.mocked(api.generateSandboxPdf).mockRejectedValueOnce(
      new Error('You have used the free downloads available from this network for now.')
    )

    await usePreviewStore.getState().downloadSandbox()

    expect(usePreviewStore.getState().error).toContain('free downloads available')
    expect(usePreviewStore.getState().loading).toBe(false)
  })
})

/**
 * The browser-side "one free" flag.
 *
 * <p>Explicitly a courtesy, not a control — see lib/sandboxDownload.ts. The
 * case worth pinning is Safari private mode, where touching localStorage
 * throws: a visitor who cannot be tracked must get their document rather than a
 * sign-up wall.
 */
describe('free download flag', () => {
  beforeEach(() => vi.resetModules())

  it('round-trips through localStorage', async () => {
    const store: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v },
    })
    const { hasUsedFreePdf, markFreePdfUsed } = await import('../lib/sandboxDownload')

    expect(hasUsedFreePdf()).toBe(false)
    markFreePdfUsed()
    expect(hasUsedFreePdf()).toBe(true)
  })

  it('treats unavailable storage as not-yet-used, and never throws', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new DOMException('denied') },
      setItem: () => { throw new DOMException('denied') },
    })
    const { hasUsedFreePdf, markFreePdfUsed } = await import('../lib/sandboxDownload')

    expect(hasUsedFreePdf()).toBe(false)
    expect(() => markFreePdfUsed()).not.toThrow()
  })
})
