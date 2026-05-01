import { test, expect } from '@playwright/test'

import { comparePngBuffers, expectWithinBudget } from './helpers/pixelCompare'

/**
 * Phase 5.5 — canvas-vs-PDF pixel-parity E2E suite.
 *
 * SKIPPED until `npx playwright install chromium` runs and the seed layouts
 * are committed under `tests/e2e/fixtures/`. Unskipping this is the last step
 * before the harness goes live; the scaffolding below is intentionally
 * self-contained so a dev can wire a single seed without touching other files.
 *
 * Workflow per seed layout:
 *   1. Navigate to the editor with the layout loaded.
 *   2. Screenshot the editor canvas surface at 2× DPR.
 *   3. POST the same layout to `/api/generate/preview` to get PDF bytes.
 *   4. Rasterise PDF page 1 via `pdfjs-dist` at 2× DPR.
 *   5. `pixelmatch`-diff the two PNG buffers. Expect `<0.5%` mismatched.
 */
test.describe('pixel-parity (editor canvas vs PDF)', () => {
  test.skip('plain text element — baseline', async () => {
    // Until browsers are installed via `npx playwright install chromium`
    // this test stays skipped. The comparator below is exercised by unit
    // tests in `src/lib/pixelParity.test.ts`.
    const emptyBuf = Buffer.alloc(4 * 4 * 4, 0xff)
    const diff = comparePngBuffers(emptyBuf, emptyBuf, undefined)
    expect(diff).toBe(0)
    expectWithinBudget(diff, 0.005)
  })
})
