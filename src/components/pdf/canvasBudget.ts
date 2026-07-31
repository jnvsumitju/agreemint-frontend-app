/**
 * Canvas size budget for PDF page rendering.
 *
 * <p>Browsers cap how large a canvas may be, and they do it silently: past the
 * limit the canvas allocates but paints nothing, so the page comes out blank
 * with no error anywhere. Zooming out drops it back under the cap, which is why
 * "zoom out and back in" appears to fix it.
 *
 * <p>The numbers mirror what pdf.js's own viewer uses — `maxCanvasPixels`
 * 2^25 by default (`web/pdf_viewer.mjs:4303`) with a 5,242,880 override for
 * mobile (`:4132`). We take 2^24, half of theirs, because the cost of being
 * wrong is asymmetric: too low costs sharpness nobody will notice at these zoom
 * levels, too high costs the entire page with no error to diagnose from.
 *
 * <p>These are ceilings, not measurements. A canvas at 16.7M pixels was
 * confirmed rendering correctly on desktop Chrome, so the desktop limit is
 * somewhere above that and the budget is not what was causing blank pages —
 * that was a render race, fixed in PdfCustomViewer. The budget stays because
 * the mobile ceiling is real and a zoomed page reaches it easily.
 *
 * <p>Deliberately DOM-free so it can be unit-tested under vitest's node
 * environment. The UA sniffing takes its inputs as arguments.
 */

export interface CanvasBudget {
  /** Maximum width × height in device pixels. */
  maxArea: number
  /** Maximum length of either side in device pixels. */
  maxSide: number
}

export const DESKTOP_BUDGET: CanvasBudget = { maxArea: 2 ** 24, maxSide: 8192 }

/** iOS/Android are far tighter, and several GPUs cap a side at 4096. */
export const MOBILE_BUDGET: CanvasBudget = { maxArea: 5_242_880, maxSide: 4096 }

/** Never supersample beyond 2×; past that the cost is real and the gain is not. */
const MAX_OUTPUT_SCALE = 2
/** Below this the page is unreadable — better to show it soft than to shrink further. */
const MIN_OUTPUT_SCALE = 0.25

/** Override key for diagnosing a specific machine without a redeploy. */
export const BUDGET_OVERRIDE_KEY = 'agreemint-pdf-max-canvas-area'

/**
 * Pick a budget from UA hints.
 *
 * <p>Takes its inputs as arguments rather than reading `navigator` so it stays
 * testable. The `MacIntel` + touch-points case is iPadOS, which reports itself
 * as a Mac but has a mobile GPU — pdf.js special-cases it for the same reason.
 */
export function pickCanvasBudget(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
  areaOverride?: number,
): CanvasBudget {
  const isIOS = /iPad|iPhone|iPod/.test(userAgent)
    || (platform === 'MacIntel' && maxTouchPoints > 1)
  const isAndroid = /Android/.test(userAgent)
  const base = isIOS || isAndroid ? MOBILE_BUDGET : DESKTOP_BUDGET

  if (areaOverride != null && Number.isFinite(areaOverride) && areaOverride > 0) {
    return { maxArea: areaOverride, maxSide: base.maxSide }
  }
  return base
}

/**
 * The device-pixel multiplier to render this page at.
 *
 * <p>Starts from `devicePixelRatio` and shrinks until the canvas fits the
 * budget on both the side and the area constraint. Returns a value that may be
 * below 1 — a soft page is the correct outcome when the alternative is nothing.
 */
export function resolveOutputScale(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  budget: CanvasBudget,
): number {
  if (!(cssWidth > 0) || !(cssHeight > 0)) return MIN_OUTPUT_SCALE

  let scale = Math.min(devicePixelRatio || 1, MAX_OUTPUT_SCALE)
  scale = Math.min(scale, budget.maxSide / cssWidth, budget.maxSide / cssHeight)
  scale = Math.min(scale, Math.sqrt(budget.maxArea / (cssWidth * cssHeight)))

  if (!Number.isFinite(scale)) return MIN_OUTPUT_SCALE
  return Math.max(scale, MIN_OUTPUT_SCALE)
}

/**
 * The largest CSS scale whose canvas still fits the budget at 1× output.
 *
 * <p>Lets the zoom control stop at a limit that is real, instead of offering a
 * zoom level that renders blank.
 */
export function maxCssScaleForBudget(
  baseWidth: number,
  baseHeight: number,
  budget: CanvasBudget,
): number {
  if (!(baseWidth > 0) || !(baseHeight > 0)) return 1
  const bySide = Math.min(budget.maxSide / baseWidth, budget.maxSide / baseHeight)
  const byArea = Math.sqrt(budget.maxArea / (baseWidth * baseHeight))
  return Math.max(0.1, Math.min(bySide, byArea))
}

/** Read the localStorage override, if any. Safe in SSR / privacy modes. */
export function readBudgetOverride(): number | undefined {
  try {
    const raw = localStorage.getItem(BUDGET_OVERRIDE_KEY)
    if (!raw) return undefined
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : undefined
  } catch {
    return undefined
  }
}

/** The budget for the current browser. */
export function currentCanvasBudget(): CanvasBudget {
  if (typeof navigator === 'undefined') return DESKTOP_BUDGET
  return pickCanvasBudget(
    navigator.userAgent,
    navigator.platform ?? '',
    navigator.maxTouchPoints ?? 0,
    readBudgetOverride(),
  )
}
