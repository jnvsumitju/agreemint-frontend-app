import type { LayoutJson } from '../types/layout'
import type { ElementMeasurement, MeasureLayoutResponse } from './api'

/**
 * Minimal element shape used by overflow checking. Matches the wire format
 * ({@link LayoutJson} uses `Record<string, unknown>[]`), so we don't have
 * to pull in the full {@link import('../types/layout').LayoutElement} type
 * when the editor-store snapshot is the caller.
 */
type WireElement = Record<string, unknown>

/**
 * Pixel-parity soft-assist input for save-time overflow warnings.
 *
 * The backend measurement pass tells us the exact height iText will consume
 * for each text element. If that exceeds the authored box height, the PDF
 * will render text that the canvas preview clipped — the two rendering
 * surfaces disagree. Rather than hard-block the save, we surface these
 * elements so the author can either grow the boxes to fit (preferred) or
 * accept the divergence and save anyway.
 *
 * Only text-bearing elements are checked; table / list / shape overflow is
 * phase 2+ scope.
 */
export interface Overflow {
  elementId: string
  /** Current authored box height (pt). */
  boxHeight: number
  /** Height iText measured (pt). */
  measuredHeight: number
  /** `measured - box`, always positive. */
  delta: number
  /** Top-level elements only — nested TABLE cells / LIST items land in phase 2. */
  elementType: string | undefined
}

const TEXT_LIKE_TYPES = new Set(['TEXT', 'PARAGRAPH', 'HEADER', 'FOOTER', 'FLOATING'])
const TABLE_TYPE = 'TABLE'

function* walkTopLevelElements(layout: LayoutJson): Generator<WireElement> {
  if (Array.isArray(layout.pages) && layout.pages.length > 0) {
    for (const page of layout.pages) {
      if (Array.isArray(page.elements)) yield* page.elements
    }
    return
  }
  if (Array.isArray(layout.elements)) yield* layout.elements
}

function isTextLike(el: WireElement): boolean {
  // Default dispatch is TEXT when type is absent — mirrors the backend
  // `dispatchElementByType` fallthrough.
  const t = el.type
  return !t || (typeof t === 'string' && TEXT_LIKE_TYPES.has(t))
}

function elementId(el: WireElement): string | undefined {
  return typeof el.id === 'string' ? el.id : undefined
}

function elementType(el: WireElement): string | undefined {
  return typeof el.type === 'string' ? el.type : undefined
}

function elementHeight(el: WireElement): number {
  return typeof el.height === 'number' ? el.height : 0
}

/**
 * Diff the layout against the measurement response. Returns one entry per
 * text element whose laid-out height exceeds its box height by more than
 * 0.5pt — sub-point noise (sub-pixel rounding, ascender/descender drift) is
 * ignored so every author doesn't see a toast on every save.
 */
export function findOverflowingElements(
  layout: LayoutJson,
  measurements: MeasureLayoutResponse['measurements'] | Record<string, ElementMeasurement>,
): Overflow[] {
  const out: Overflow[] = []
  for (const el of walkTopLevelElements(layout)) {
    const id = elementId(el)
    if (!id) continue
    const m = measurements[id]
    if (!m) continue
    const type = elementType(el)
    if (isTextLike(el)) {
      if (m.measuredHeight <= 0) continue
      const boxHeight = elementHeight(el)
      if (boxHeight <= 0) continue
      const delta = m.measuredHeight - boxHeight
      if (delta > 0.5) {
        out.push({
          elementId: id,
          boxHeight,
          measuredHeight: m.measuredHeight,
          delta,
          elementType: type,
        })
      }
    } else if (type === TABLE_TYPE) {
      // Phase 2.5: TABLE row-height measurement. Sum of row heights
      // (header + body) is the total the PDF will consume; if that
      // exceeds the authored box, the soft-assist grow action bumps
      // the element height to fit.
      if (!m.rowHeights || m.rowHeights.length === 0) continue
      const summed = m.rowHeights.reduce((a, b) => a + b, 0)
      const boxHeight = elementHeight(el)
      if (boxHeight <= 0) continue
      const delta = summed - boxHeight
      if (delta > 0.5) {
        out.push({
          elementId: id,
          boxHeight,
          measuredHeight: summed,
          delta,
          elementType: type,
        })
      }
    }
  }
  return out
}

/**
 * Produce a new layout where every overflowing element's height is bumped to
 * the measured height plus a small buffer. Does not mutate the input — the
 * caller applies the returned layout via the editor store.
 */
export function growOverflowingElementHeights(
  layout: LayoutJson,
  overflows: Overflow[],
  bufferPt = 2,
): LayoutJson {
  if (overflows.length === 0) return layout
  const byId = new Map(overflows.map((o) => [o.elementId, o] as const))
  const patchArray = (arr: WireElement[] | undefined): WireElement[] | undefined => {
    if (!arr) return arr
    return arr.map((el) => {
      const id = elementId(el)
      if (!id) return el
      const o = byId.get(id)
      if (!o) return el
      return { ...el, height: Math.ceil(o.measuredHeight + bufferPt) }
    })
  }
  if (Array.isArray(layout.pages) && layout.pages.length > 0) {
    return {
      ...layout,
      pages: layout.pages.map((page) => ({
        ...page,
        elements: patchArray(page.elements) ?? page.elements,
      })),
    }
  }
  return { ...layout, elements: patchArray(layout.elements) ?? layout.elements }
}
