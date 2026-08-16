#!/usr/bin/env node
/**
 * Screenshots each try-template's rendered page and writes it into the
 * marketing site's public assets, so `crixaa.com/templates/<slug>` can show
 * what the document actually looks like.
 *
 * Run with the console dev server up:
 *   npm run dev            # in one terminal
 *   node scripts/capture-template-previews.mjs
 *
 * <p>The capture goes through the real editor canvas rather than a
 * purpose-built preview renderer. That is the whole point: a second renderer
 * would drift from the first, and the failure mode is a marketing page showing
 * a document that no longer matches what the visitor gets when they click
 * through. Screenshotting the thing itself cannot drift.
 *
 * <p>Re-run it whenever a bundle changes. The output is deterministic enough to
 * commit — same layout in, same PNG out.
 */

import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUNDLES = join(HERE, '..', 'src', 'try-templates')

/**
 * Where the captures land: the marketing repo's `assets/`, not its `public/`.
 * These PNGs are a build input — the marketing side derives the WebP the site
 * actually serves — so they should not also be uploaded and served.
 *
 * <p>Overridable, and asserted. The default assumes the two repositories are
 * siblings, which is true here but is an assumption this script cannot verify
 * on its own; without the check below, `mkdirSync(..., {recursive: true})`
 * would happily fabricate the whole path somewhere unexpected and then report
 * twenty successful captures into a directory nothing reads.
 */
const OUT =
  process.env.PREVIEW_OUT_DIR ??
  join(HERE, '..', '..', 'agreemint-frontend-marketing-app', 'assets', 'template-previews')

const BASE = process.env.PREVIEW_BASE_URL ?? 'http://localhost:5173'
const CANVAS = '[data-agreemint-page-canvas]'

const slugs = readdirSync(BUNDLES)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort()

// Require the parent to exist already, so a wrong assumption fails here rather
// than silently creating an orphan tree.
const outParent = dirname(OUT)
if (!existsSync(outParent)) {
  console.error(`Destination parent does not exist: ${outParent}`)
  console.error(
    'The marketing repo is expected alongside this one. Set PREVIEW_OUT_DIR to override.'
  )
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()

/**
 * Capture geometry. Both values matter, and the viewport is the subtle one.
 *
 * <p>`TryTemplateEditor` picks an initial canvas zoom from `window.innerWidth`:
 * 50% below 1024, 66% below 1440, and otherwise it leaves the layout's own
 * 100%. So a viewport narrower than 1440 silently scales the document *before*
 * `deviceScaleFactor` is applied — at Playwright's 1280 default that made a
 * nominal 2× capture an actual 1.32×, and a 595pt-wide A4 page came out 788px
 * instead of 1190px.
 *
 * <p>A 1600px viewport keeps the editor at 100%, so the scale factor below
 * means what it says: 595 x 842 pt renders at 1785 x 2526 px, a true 3×. The
 * detail page displays it at up to 672 CSS px, so that is ~2.7× — comfortably
 * sharp on any 2× display, with headroom for a wider layout later.
 */
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 3,
})
const page = await context.newPage()

let failed = 0

for (const slug of slugs) {
  try {
    await page.goto(`${BASE}/try/${slug}`, { waitUntil: 'load' })
    const canvas = page.locator(CANVAS)
    await canvas.waitFor({ state: 'visible', timeout: 20_000 })

    // The boot is async — the bundle is a lazily-imported chunk. Waiting for
    // the canvas element alone would capture an empty page.
    await page.waitForFunction(
      (sel) => (document.querySelector(sel)?.textContent?.length ?? 0) > 200,
      CANVAS,
      { timeout: 20_000 }
    )
    // Web fonts settle after first paint; without this the capture can show a
    // fallback face.
    await page.evaluate(() => document.fonts.ready)

    await canvas.screenshot({ path: join(OUT, `${slug}.png`) })
    console.log(`  ${slug}.png`)
  } catch (err) {
    console.error(`  ✗ ${slug}: ${err instanceof Error ? err.message : err}`)
    failed++
  }
}

await browser.close()

if (failed > 0) {
  console.error(`\n${failed} of ${slugs.length} previews failed. Is the dev server running?`)
  process.exit(1)
}

console.log(`\n${slugs.length} previews written to ${OUT}`)
