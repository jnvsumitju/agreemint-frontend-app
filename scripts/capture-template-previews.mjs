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
import { mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUNDLES = join(HERE, '..', 'src', 'try-templates')
const OUT = join(HERE, '..', '..', 'agreemint-frontend-marketing-app', 'public', 'template-previews')

const BASE = process.env.PREVIEW_BASE_URL ?? 'http://localhost:5173'
const CANVAS = '[data-agreemint-page-canvas]'

const slugs = readdirSync(BUNDLES)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort()

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
// 2× so the PNG stays sharp on a retina display at the size the page renders it.
const context = await browser.newContext({ deviceScaleFactor: 2 })
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
