import { defineConfig, devices } from '@playwright/test'

/**
 * Phase 5.5 — Playwright config for the local-only pixel-parity E2E suite.
 *
 * Run:  `npx playwright install chromium` once, then `npm run test:e2e`.
 *
 * The harness drives the editor canvas, screenshots the rendered page at 2× DPR,
 * hits the backend's `/api/generate/preview`, rasterises PDF page 1 with
 * `pdfjs-dist` at the same DPR, and pixel-compares via `pixelmatch`. Tolerance
 * is `<0.5%` pixel diff with anti-aliasing threshold `0.1` — tuned to absorb
 * Chromium-vs-iText sub-glyph drift while catching real regressions.
 *
 * CI gating lands as a follow-on once the seed set stabilises (per the
 * pixel-parity plan's phase 5.5 decision).
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    // DPR 2 matches the rasterise-pdf DPR below so screenshot and PDF pixel
    // dimensions line up before the pixelmatch diff.
    deviceScaleFactor: 2,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // The PDF viewer's canvas budget and its device-pixel maths are a function
    // of devicePixelRatio, so it is exercised at 1× and 3× as well. These are
    // separate projects rather than an edit to the one above, because the
    // pixel-parity suite pins DPR 2 to match its rasterisation step — changing
    // that would silently invalidate every one of its baselines.
    {
      name: 'pdf-dpr1',
      testMatch: /pdf-viewer\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 },
    },
    {
      name: 'pdf-dpr3',
      testMatch: /pdf-viewer\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 3 },
    },
  ],
  webServer: [
    {
      command: 'npm run dev',
      port: 5173,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    // Backend expects to be running separately (Spring Boot cold start is 8–15s
    // and the integration auth context is fiddly to boot fresh per test).
    // Enable this block once the Maven harness is set up:
    // {
    //   command: 'cd ../agreemint-backend-app && ./mvnw spring-boot:run',
    //   port: 9092,
    //   reuseExistingServer: true,
    //   timeout: 180_000,
    // },
  ],
})
