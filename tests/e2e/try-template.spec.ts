import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

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

/**
 * Double-click a canvas text element and replace its content.
 *
 * <p>The wait is load-bearing, not defensive. `dblclick` only mounts the TipTap
 * editor; ProseMirror takes focus a tick later. Keystrokes sent before that go
 * to the document, so `ControlOrMeta+A` selects nothing and the first character
 * is swallowed — the observed failure was the original heading still in place
 * with `lackwood Logistics` appended. It reproduces only under load, which is
 * exactly the flake that gets re-run until green and then ignored.
 */
async function replaceCanvasText(page: Page, current: string, next: string) {
  const el = page.locator(CANVAS).getByText(current).first()
  // `force` because the absolutely-positioned element wrapper sits over its own
  // text node and Playwright's actionability check calls that an interception.
  // The wrapper carries the dblclick handler, so dispatching there is what a
  // real double-click does anyway.
  await el.dblclick({ force: true })

  const surface = page.locator(`${CANVAS} .ProseMirror`).first()
  await expect(surface).toBeFocused()

  await page.keyboard.press('ControlOrMeta+A')
  // Deliberately character-by-character with a delay. A single fast fill() would
  // not exercise what this guards: the editor is rebuilt between keystrokes when
  // the Y.Doc is unstable, so only sustained typing loses characters.
  await page.keyboard.type(next, { delay: 30 })

  // Exact text on the editing surface itself, not `toContainText` on the canvas.
  // The old text appears elsewhere in the invoice (bank details, signatory), so
  // a canvas-wide check can never go clean; and an exact match is what catches
  // the swallowed-character case, where the surface reads
  // `Northwind Traders Pvt Ltdlackwood Logistics` and every "contains" passes.
  await expect(surface).toHaveText(next)
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

    const typed = 'Blackwood Logistics'
    await replaceCanvasText(page, 'Northwind Traders Pvt Ltd', typed)

    await expect(page.locator(CANVAS)).toContainText(typed)
    expect(apiCalls, 'editing must not trigger a draft or measurement call').toEqual([])
  })

  test('survives a reload, then Start over restores the original', async ({ page }) => {
    await openSandbox(page)

    await replaceCanvasText(page, 'Northwind Traders Pvt Ltd', 'Blackwood Logistics')
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

  test('every catalogue template renders values and exposes its variables', async ({ page }) => {
    // Cheap breadth: one bad bundle takes down one landing page, and there are
    // fifty of them. The unit tests check the JSON; this checks it survives the
    // parse → store → canvas path in a real browser, for every single one.
    //
    // Counts are read from the bundles rather than hardcoded, so adding a
    // template or a field to one cannot silently fall out of coverage.
    const here = path.dirname(new URL(import.meta.url).pathname)
    const dir = path.join(here, '..', '..', 'src', 'try-templates')

    // One navigation and a canvas render per template, in one test. Playwright's
    // default 30s covered twenty and silently stopped covering fifty — the
    // failure looked like a broken template rather than an exhausted budget.
    // Derived from the catalogue so it keeps pace as templates are added.
    test.setTimeout(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length * 4_000)

    const bundles = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const bundle = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
        const raw = JSON.stringify(bundle.layout)
        // What the *document* uses, not what it declares — the two are only the
        // same when the bundle is correct, and asserting the panel against the
        // declaration list alone would be tautological: both come from this file.
        // The bug this guards against (a generator that inlines values and emits
        // `globalVariables: []`) leaves a canvas that looks perfect and a Vars
        // tab that is empty, and a declared-vs-declared check passes on it.
        const referenced = new Set(
          [...raw.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)].map((m) => m[1]),
        )
        // TABLE/LIST elements bind structurally via `dataKey` rather than a token.
        for (const m of raw.matchAll(/"dataKey"\s*:\s*"([a-zA-Z0-9_.]+)"/g)) referenced.add(m[1])
        return {
          slug: f.replace(/\.json$/, ''),
          declared: ((bundle.layout.globalVariables ?? []) as { key: string }[]).map((d) => d.key),
          referenced: [...referenced],
        }
      })

    // Against the catalogue rather than a literal, so adding a template never
    // needs this number remembered — which is exactly when it gets forgotten.
    //
    // Read as TEXT rather than imported. `tryTemplates.ts` reaches for
    // `import.meta.env`, which exists under Vite and not under Playwright's
    // Node runtime, so importing it throws while the spec file is still being
    // loaded and Playwright reports "No tests found" — the whole file silently
    // stops running rather than failing a single assertion.
    const catalogue = [
      ...fs
        .readFileSync(path.join(here, '..', '..', 'src', 'lib', 'tryTemplates.ts'), 'utf8')
        .matchAll(/\{\s*slug:\s*'([a-z0-9-]+)'/g),
    ].map((m) => m[1])

    expect(catalogue.length, 'no slugs found in the catalogue source').toBeGreaterThan(0)
    expect(bundles.map((b) => b.slug).sort(), 'bundles and catalogue disagree').toEqual(
      [...catalogue].sort()
    )

    for (const { slug, declared, referenced } of bundles) {
      await page.goto(`/try/${slug}`)
      const canvas = page.locator(CANVAS)
      await canvas.waitFor({ state: 'visible' })
      await expect(canvas, `${slug} rendered no text`).not.toBeEmpty()

      // With the Values toggle on by default the canvas must read as the
      // finished document: no raw tokens, and no `Global.Field Name` chips.
      // Either would mean a visitor's first sight of the product is a wireframe.
      // (A field whose preview value is blank shows up here too — the chip is
      // what the canvas falls back to.)
      await expect(canvas, `${slug} shows an unresolved token`).not.toContainText('{{')
      await expect(canvas, `${slug} shows a merge-field chip`).not.toContainText('Global.')

      // And the same template, opened in a workspace, has to be a usable
      // *template* rather than a flattened document. Anchored on the row ids
      // rather than label text, so a copy change cannot quietly match nothing
      // and read as a pass.
      await page.getByRole('tab', { name: 'Vars' }).click()
      const rows = await page.evaluate(() => {
        const keyInputs = [
          ...document.querySelectorAll('input[id^="ag-var-global-"][id$="-key"]'),
        ] as HTMLInputElement[]
        return keyInputs.map((keyEl) => {
          const row = keyEl.closest('li')
          // Scalar rows render a `-scalar` input; TABLE/LIST-bound rows render a
          // JSON textarea instead. Both count as carrying a value.
          const valueEl = row?.querySelector(
            'input[id$="-scalar"], textarea[id$="-table-json"], textarea[id$="-list-json"]',
          ) as HTMLInputElement | HTMLTextAreaElement | null
          return { key: keyEl.value, value: valueEl?.value ?? null }
        })
      })

      const shown = rows.map((r) => r.key)
      expect(referenced.length, `${slug} references no variables at all`).toBeGreaterThan(0)

      // The load-bearing one: every field the document uses is offered for editing.
      expect(
        referenced.filter((k) => !shown.includes(k)).sort(),
        `${slug} uses fields the Vars panel does not list`,
      ).toEqual([])

      // And the panel survives the parse → store → panel round-trip intact.
      expect(shown.slice().sort(), `${slug} variable list`).toEqual([...declared].sort())

      expect(
        rows.filter((r) => r.value === null || r.value.trim() === '').map((r) => r.key),
        `${slug} has fields with no preview value`,
      ).toEqual([])
    }
  })
})
