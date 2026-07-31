import { expect, test, type Locator, type Page } from '@playwright/test'
import { PNG } from 'pngjs'

/**
 * End-to-end cover for the rebuilt PDF viewer.
 *
 * <p>These exist because of a specific failure: the previous viewer rendered a
 * blank page on first paint and only drew once the user zoomed. It threw
 * nothing, logged nothing, and every unit test passed — the canvas was the right
 * size and the render promise resolved. Only a real browser painting real pixels
 * can tell a rendered page from an empty one, which is what this file does.
 *
 * <p>Runs against the dev-only harness route, so no backend, login or fixture
 * binary is involved — see `src/pages/PdfViewerHarness.tsx`.
 *
 * <p><b>Ink is measured from a screenshot, never `getImageData`.</b> During this
 * work `getImageData` was observed reporting a uniformly white surface for a
 * canvas that visibly contained black text, which makes it worthless as the
 * oracle for exactly the bug being tested. A screenshot goes through the
 * compositor and shows what the user sees.
 */

const HARNESS = '/__pdf-harness?chrome=0&pages=12'

/** Fraction of pixels that are not near-white. A blank page scores ~0. */
async function inkFraction(target: Locator): Promise<number> {
  const buffer = await target.screenshot()
  const png = PNG.sync.read(buffer)
  let ink = 0
  const total = png.width * png.height
  for (let i = 0; i < total; i++) {
    const o = i * 4
    if (png.data[o] < 200 || png.data[o + 1] < 200 || png.data[o + 2] < 200) ink++
  }
  return ink / total
}

/**
 * Ink in the scroller, i.e. in the region the reader is actually looking at.
 *
 * <p>Measuring the whole page tile does not work at high zoom: the tile is then
 * several thousand pixels tall and its top-left corner — which is what a
 * clipped element screenshot captures — is page margin, so a perfectly rendered
 * page scores near zero. The viewport is both the honest question ("can the user
 * see the document?") and a fixed size at every zoom level.
 */
async function visibleInk(page: Page): Promise<number> {
  return inkFraction(page.locator('[data-pdf-scroller]').first())
}

async function firstPage(page: Page): Promise<Locator> {
  const tile = page.locator('[data-pdf-page="1"]').first()
  await expect(tile).toHaveAttribute('data-pdf-page-state', 'done', { timeout: 20_000 })
  return tile
}

/** Jump to a page through the toolbar and wait for it to finish drawing. */
async function goToPage(page: Page, n: number): Promise<void> {
  const indicator = page.getByLabel('Page number')
  await indicator.fill(String(n))
  await indicator.press('Enter')
  await expect(page.locator(`[data-pdf-page="${n}"]`)).toHaveAttribute(
    'data-pdf-page-state', 'done', { timeout: 20_000 },
  )
  // Let the smooth scroll land before anything is measured.
  await page.waitForTimeout(600)
}

/** Collect console errors so a silent pdf.js refusal cannot pass unnoticed. */
function watchConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  return errors
}

test.describe('PDF viewer rendering', () => {
  for (const viewport of [
    { name: 'narrow', width: 1280, height: 800 },
    { name: 'wide', width: 2560, height: 1440 },
  ]) {
    for (const zoom of ['fit-width', 'actual', '400'] as const) {
      test(`paints the first page at ${viewport.name} / ${zoom}`, async ({ page }) => {
        const errors = watchConsole(page)
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.goto(HARNESS)

        await firstPage(page)

        if (zoom !== 'fit-width') {
          await page.getByRole('button', { name: /^Zoom, currently/ }).click()
          const label = zoom === 'actual' ? 'Actual size' : '400%'
          await page.getByRole('menuitemradio', { name: label }).click()
          // The tile is re-rendered at the new scale; wait for that to settle
          // rather than asserting against the previous bitmap.
          await expect(page.locator('[data-pdf-page="1"]').first())
            .toHaveAttribute('data-pdf-page-state', 'done', { timeout: 20_000 })
        }

        const ink = await visibleInk(page)

        // A rendered page sits far above this; a blank one is exactly 0, because
        // both an unpainted canvas and the placeholder are near-white.
        expect(ink, `nothing visible on screen (ink=${ink})`).toBeGreaterThan(0.02)

        // The specific symptom of the original bug, in pdf.js's own words.
        expect(errors.join('\n')).not.toContain('same canvas')
      })
    }
  }

  test('every mounted canvas stays inside the canvas budget', async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1440 })
    await page.goto(HARNESS)
    await firstPage(page)

    // Zoom right in, which is where the budget actually binds.
    await page.getByRole('button', { name: /^Zoom, currently/ }).click()
    await page.getByRole('menuitemradio', { name: '400%' }).click()
    await expect(page.locator('[data-pdf-page="1"]').first())
      .toHaveAttribute('data-pdf-page-state', 'done', { timeout: 20_000 })

    const sizes = await page.$$eval('[data-pdf-page] canvas', (nodes) =>
      nodes.map((n) => {
        const c = n as HTMLCanvasElement
        return { w: c.width, h: c.height }
      }),
    )

    expect(sizes.length).toBeGreaterThan(0)
    for (const { w, h } of sizes) {
      // DESKTOP_BUDGET in canvasBudget.ts. Past these a canvas allocates and
      // then silently paints nothing.
      expect(w * h, `canvas ${w}x${h} exceeds the area budget`).toBeLessThanOrEqual(2 ** 24)
      expect(Math.max(w, h), `canvas ${w}x${h} exceeds the side budget`).toBeLessThanOrEqual(8192)
    }
  })

  test('virtualizes: a long document never mounts many canvases', async ({ page }) => {
    await page.goto('/__pdf-harness?chrome=0&pages=120')
    await firstPage(page)

    const scroller = page.locator('[data-pdf-scroller]').first()
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight })
    await page.waitForTimeout(1200)

    const count = await page.locator('[data-pdf-page]').count()
    expect(count, 'virtualization window grew unbounded').toBeLessThanOrEqual(12)
  })

  test('the page indicator follows the scroll position', async ({ page }) => {
    await page.goto(HARNESS)
    await firstPage(page)

    const indicator = page.getByLabel('Page number')
    await expect(indicator).toHaveValue('1')

    const scroller = page.locator('[data-pdf-scroller]').first()
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight })

    await expect(indicator).not.toHaveValue('1', { timeout: 10_000 })
  })

  test('a page reached by navigating actually paints', async ({ page }) => {
    // The original bug only ever showed on a *first* paint, so a page that has
    // never been on screen before is the interesting case.
    await page.goto(HARNESS)
    await firstPage(page)

    await goToPage(page, 12)

    const ink = await visibleInk(page)
    expect(ink, `page 12 never appeared (ink=${ink})`).toBeGreaterThan(0.02)
  })
})

test.describe('PDF viewer chrome', () => {
  test('full screen opens, paints, and closes on Escape', async ({ page }) => {
    await page.goto(HARNESS)
    await firstPage(page)

    await page.getByRole('button', { name: 'Full screen' }).click()
    const overlay = page.getByRole('dialog', { name: 'Document, full screen' })
    await expect(overlay).toBeVisible()

    // Re-rendering into a much larger box is the moment the old viewer blanked.
    const tile = overlay.locator('[data-pdf-page="1"]').first()
    await expect(tile).toHaveAttribute('data-pdf-page-state', 'done', { timeout: 20_000 })
    const ink = await inkFraction(overlay.locator('[data-pdf-scroller]').first())
    expect(ink, `full screen showed nothing (ink=${ink})`).toBeGreaterThan(0.02)

    await page.keyboard.press('Escape')
    await expect(overlay).toBeHidden()
  })

  test('properties dialog reports the real page count and size', async ({ page }) => {
    await page.goto(HARNESS)
    await firstPage(page)

    await page.getByRole('button', { name: 'Document properties' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('12')
    // Not "612 × 792 pt" — the point of the rewrite was a readable size.
    await expect(dialog).toContainText('Letter')
  })

  test('typing a page number jumps to that page', async ({ page }) => {
    await page.goto(HARNESS)
    await firstPage(page)

    await goToPage(page, 9)

    // The indicator is derived from scroll position, so it agreeing is proof
    // the jump landed rather than proof the field kept what was typed.
    await expect(page.getByLabel('Page number')).toHaveValue('9')
  })
})
