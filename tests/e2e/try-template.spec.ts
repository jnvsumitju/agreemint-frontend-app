import { expect, test, type Page } from '@playwright/test'

/**
 * End-to-end cover for the anonymous try-a-template sandbox at `/try/:slug`.
 *
 * <p>The whole design rests on one property that no unit test can check: a
 * logged-out visitor can use the full editor and the app never touches
 * `/api/**`. If that stops being true the failure is not a visible error — a
 * 401 with a stale refresh token in localStorage triggers `authFetch`'s
 * logout-and-redirect, which hard-navigates out of the page and destroys work
 * the visitor has not saved. So the request log is asserted directly.
 *
 * <p>The second property is the Yjs one. `getYDoc` mints a fresh `Y.Doc` on
 * every call while no provider is active, `EditorCanvas` calls `getYFragment`
 * during render, and TipTap memoises its extensions on fragment identity — so
 * skipping `connectYDoc` makes the editor rebuild itself on every keystroke and
 * the caret dies as you type. It looks like a stuck keyboard, throws nothing,
 * and no unit test sees it. Typing a whole word and reading it back is the only
 * way to catch it.
 *
 * <p>No backend, no login, no fixtures — that is the point of the feature.
 */

const SLUG = 'free-gst-invoice-template'
const CANVAS = '[data-agreemint-page-canvas]'

/** Records every request the page makes to the API, for the whole test. */
function trackApiCalls(page: Page): string[] {
  const calls: string[] = []
  page.on('request', (req) => {
    const url = req.url()
    // In dev, Vite serves `src/lib/api.ts` as a module over HTTP — that is the
    // source file, not a call to the API. Match the API path itself.
    if (/\/api\/(?!.*\.tsx?$)/.test(url)) calls.push(`${req.method()} ${url}`)
  })
  return calls
}

async function openSandbox(page: Page, slug = SLUG) {
  await page.goto(`/try/${slug}`)
  await page.locator(CANVAS).waitFor({ state: 'visible' })
  // Boot is async (the bundle is a lazily-imported chunk); wait for content.
  await expect(page.locator(CANVAS)).toContainText('Northwind Traders', { timeout: 15_000 })
}

test.describe('anonymous try-a-template sandbox', () => {
  test('loads a prebuilt template with no account and no API calls', async ({ page }) => {
    const apiCalls = trackApiCalls(page)
    await openSandbox(page)

    // Real content, not merge-field placeholders. A visitor arriving from a
    // search for "free GST invoice template" must see a finished invoice.
    const canvas = page.locator(CANVAS)
    await expect(canvas).toContainText('TAX INVOICE')
    await expect(canvas).toContainText('₹1,41,600.00')
    await expect(canvas).not.toContainText('{{')
    await expect(canvas).not.toContainText('Global.Company Name')

    expect(apiCalls, 'the sandbox must not touch the API').toEqual([])
  })

  test('is editable, not read-only — reset() fails closed, enterSandbox must undo it', async ({
    page,
  }) => {
    await openSandbox(page)

    // The Editing/View-only toggle renders only when `canEdit` is true, and the
    // left palette only when not view-only. Both are downstream of
    // `enterSandbox()` having run before `loadLayout`.
    await expect(page.getByRole('button', { name: /editing|view.only/i })).toBeVisible()
    await expect(page.getByText('Insert & tools')).toBeVisible()
  })

  test('typing into a text element keeps the caret and lands every character', async ({ page }) => {
    const apiCalls = trackApiCalls(page)
    await openSandbox(page)

    // `force` because the absolutely-positioned element wrapper sits over its
    // own text node and Playwright's actionability check calls that an
    // interception. The wrapper is the element that carries the dblclick
    // handler, so dispatching there is what a real double-click does anyway.
    const heading = page.locator(CANVAS).getByText('Northwind Traders Pvt Ltd').first()
    await heading.dblclick({ force: true })

    const typed = 'Blackwood Logistics'
    // Deliberately character-by-character with a delay. A single fast fill()
    // would not exercise the failure this guards: the editor is rebuilt between
    // keystrokes, so only sustained typing loses characters.
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type(typed, { delay: 30 })

    await expect(page.locator(CANVAS)).toContainText(typed)
    expect(apiCalls, 'editing must not trigger a draft or measurement call').toEqual([])
  })

  test('survives a reload, then Start over restores the original', async ({ page }) => {
    await openSandbox(page)

    const heading = page.locator(CANVAS).getByText('Northwind Traders Pvt Ltd').first()
    await heading.dblclick({ force: true })
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.type('Blackwood Logistics', { delay: 30 })
    await page.locator(CANVAS).click({ position: { x: 5, y: 5 } })
    await expect(page.locator(CANVAS)).toContainText('Blackwood Logistics')

    await page.reload()
    await page.locator(CANVAS).waitFor({ state: 'visible' })
    await expect(page.locator(CANVAS)).toContainText('Blackwood Logistics', { timeout: 15_000 })

    // Without an escape hatch the edit above would be permanent for this
    // browser — every later visit restores it, and this is a page people land
    // on to see what the template comes with.
    page.on('dialog', (d) => void d.accept())
    await page.getByRole('button', { name: 'Start over' }).click()
    await page.getByRole('button', { name: /discard my changes/i }).click()

    await expect(page.locator(CANVAS)).toContainText('Northwind Traders Pvt Ltd', {
      timeout: 15_000,
    })
    await expect(page.locator(CANVAS)).not.toContainText('Blackwood Logistics')

    // And the reset must be durable, not just on screen — the persistence
    // effect's cleanup flushes the edited state as the boot switches to
    // 'loading', so the boot has to overwrite it afterwards.
    await page.reload()
    await page.locator(CANVAS).waitFor({ state: 'visible' })
    await expect(page.locator(CANVAS)).toContainText('Northwind Traders Pvt Ltd', {
      timeout: 15_000,
    })
    await expect(page.locator(CANVAS)).not.toContainText('Blackwood Logistics')
  })

  test('server-backed actions become a sign-up prompt rather than an error', async ({ page }) => {
    const apiCalls = trackApiCalls(page)
    await openSandbox(page)

    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText(/create a free account to save/i)).toBeVisible()
    expect(apiCalls, 'the wall must be reached before any request').toEqual([])

    await page.getByRole('button', { name: /keep editing/i }).click()

    await page.getByRole('button', { name: /^preview$/i }).click()
    await expect(page.getByText(/create a free account to preview/i)).toBeVisible()
    expect(apiCalls).toEqual([])
  })

  test('hides the controls that need a workspace', async ({ page }) => {
    await openSandbox(page)

    // Asserted as the exact set rather than a few `toBeHidden()` calls. A
    // "hidden" assertion passes when the locator matches nothing at all, so a
    // wrong selector reads as a pass — which is precisely what happened when
    // these were written as `getByRole('button')` and the tabs are `role="tab"`.
    const sidebar = page.locator('aside').filter({ has: page.getByRole('tab', { name: 'Props' }) })
    await expect(sidebar.getByRole('tab')).toHaveText([
      'Props',
      'Rules',
      'Layers',
      'Vars',
      // Activity reads the org feed and never clears its loading flag with no
      // org, so it would spin forever; Reviews fetches on mount. Both are gone.
      // History (local undo stack) and Comments (held in the store) both work
      // offline and stay — they are what makes the sandbox feel complete.
      'History',
      'Comments',
    ])

    // Share needs a session to mint a link. Preview is asserted alongside it so
    // this cannot pass by the selector style simply not matching anything.
    await expect(page.locator('button[title="Share template"]')).toHaveCount(0)
    await expect(page.locator('button[title*="preview the PDF" i]')).toHaveCount(1)
  })

  test('an unknown slug is a clean dead end, not a crash', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.goto('/try/free-nonexistent-template')

    await expect(page.getByText(/no such template/i)).toBeVisible()
    expect(errors).toEqual([])
  })

  test('every catalogue template opens and renders content', async ({ page }) => {
    // Cheap breadth: one bad bundle takes down one landing page, and there are
    // twenty of them. The unit tests check the JSON; this checks it survives
    // the parse → store → canvas path in a real browser.
    const slugs = [
      'free-invoice-template',
      'free-receipt-template',
      'free-quotation-template',
      'free-purchase-order-template',
      'free-offer-letter-template',
      'free-experience-certificate-template',
      'free-salary-slip-template',
      'free-joining-letter-template',
      'free-relieving-letter-template',
      'free-course-certificate-template',
      'free-achievement-certificate-template',
      'free-marksheet-template',
      'free-id-card-template',
      'free-admit-card-template',
      'free-contract-template',
      'free-nda-template',
      'free-business-proposal-template',
      'free-report-template',
      'free-statement-template',
    ]

    for (const slug of slugs) {
      await page.goto(`/try/${slug}`)
      const canvas = page.locator(CANVAS)
      await canvas.waitFor({ state: 'visible' })
      await expect(canvas, `${slug} rendered no text`).not.toBeEmpty()
      await expect(canvas, `${slug} shows an unresolved placeholder`).not.toContainText('{{')
    }
  })
})
