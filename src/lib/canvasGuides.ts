import type { LayoutElement, PageGuides, PageSpec } from '../types/layout'
import { pageDimensionsPt, snap } from '../types/layout'
import {
  finalizeDragPosition,
  finalizeResizeSize,
  isOutsidePrintMargins,
  isResizeOutsidePrintMargins,
} from './layoutMargins'

const ALIGN_THRESH_PT = 5

export interface DragGuideState {
  vertical: number[]
  horizontal: number[]
}

function collectVerticalTargets(
  page: PageSpec,
  others: LayoutElement[],
  pageW: number,
  userVertical: number[] = []
): number[] {
  const { margins } = page
  const t = new Set<number>()
  t.add(margins.left)
  t.add(pageW - margins.right)
  t.add(pageW / 2)
  for (const o of others) {
    t.add(o.x)
    t.add(o.x + o.width / 2)
    t.add(o.x + o.width)
  }
  for (const x of userVertical) {
    if (Number.isFinite(x)) t.add(x)
  }
  return [...t]
}

function collectHorizontalTargets(
  page: PageSpec,
  others: LayoutElement[],
  pageH: number,
  userHorizontal: number[] = []
): number[] {
  const { margins } = page
  const t = new Set<number>()
  t.add(margins.top)
  t.add(pageH - margins.bottom)
  t.add(pageH / 2)
  for (const o of others) {
    t.add(o.y)
    t.add(o.y + o.height / 2)
    t.add(o.y + o.height)
  }
  for (const y of userHorizontal) {
    if (Number.isFinite(y)) t.add(y)
  }
  return [...t]
}

/** Best snap for vertical alignment (element left / center / right to a vertical line). */
function snapAxis1D(
  pos: number,
  span: number,
  targets: number[],
  thresh: number
): { value: number; guide: number | null; dist: number } {
  let best: { value: number; guide: number | null; dist: number } = {
    value: pos,
    guide: null,
    dist: thresh + 1,
  }
  const trySnap = (edgePos: number, guideLine: number) => {
    const d = Math.abs(edgePos - guideLine)
    if (d < thresh && d < best.dist) {
      const delta = guideLine - edgePos
      best = { value: pos + delta, guide: guideLine, dist: d }
    }
  }
  for (const g of targets) {
    trySnap(pos, g)
    trySnap(pos + span, g)
    trySnap(pos + span / 2, g)
  }
  return best
}

export function computeDragSnap(
  x: number,
  y: number,
  el: LayoutElement,
  others: LayoutElement[],
  page: PageSpec,
  opts: { snapToGrid: boolean; smartGuides: boolean; userGuides?: PageGuides; gridSize?: number },
  /** When set (e.g. header/footer band), snap uses this size; print margins do not apply inside the band. */
  viewportPt?: { width: number; height: number }
): { x: number; y: number; guides: DragGuideState; violatesMargins: boolean } {
  const { width: pw, height: ph } = viewportPt ?? pageDimensionsPt(page)
  const gs = opts.gridSize
  let nx = x
  let ny = y
  const guides: DragGuideState = { vertical: [], horizontal: [] }

  let snappedX = false
  let snappedY = false

  const ug = opts.userGuides ?? { vertical: [], horizontal: [] }
  /** Band editing: smart guides use full viewport edges, not document print margins. */
  const guidePage: PageSpec = viewportPt
    ? { ...page, margins: { left: 0, right: 0, top: 0, bottom: 0 } }
    : page

  if (opts.smartGuides) {
    const vx = collectVerticalTargets(guidePage, others, pw, ug.vertical)
    const hx = snapAxis1D(nx, el.width, vx, ALIGN_THRESH_PT)
    if (hx.guide != null) {
      nx = hx.value
      guides.vertical.push(hx.guide)
      snappedX = true
    }
    const hyTargets = collectHorizontalTargets(guidePage, others, ph, ug.horizontal)
    const hy = snapAxis1D(ny, el.height, hyTargets, ALIGN_THRESH_PT)
    if (hy.guide != null) {
      ny = hy.value
      guides.horizontal.push(hy.guide)
      snappedY = true
    }
  }

  if (opts.snapToGrid) {
    if (!snappedX) nx = snap(nx, gs)
    if (!snappedY) ny = snap(ny, gs)
  }

  const beforeMarginsX = nx
  const beforeMarginsY = ny
  const fin = viewportPt
    ? finalizeDragPositionInBandViewport(el, nx, ny, viewportPt.width, viewportPt.height, opts.snapToGrid, gs)
    : finalizeDragPosition(el, nx, ny, page, opts.snapToGrid, gs)
  nx = fin.x
  ny = fin.y

  const violatesMargins = viewportPt
    ? isOutsideBandViewport(el, beforeMarginsX, beforeMarginsY, viewportPt.width, viewportPt.height)
    : isOutsidePrintMargins(el, beforeMarginsX, beforeMarginsY, page)

  return { x: nx, y: ny, guides, violatesMargins }
}

export function computeResizeSnap(
  width: number,
  height: number,
  el: LayoutElement,
  others: LayoutElement[],
  page: PageSpec,
  opts: { snapToGrid: boolean; smartGuides: boolean; userGuides?: PageGuides; gridSize?: number },
  viewportPt?: { width: number; height: number }
): { width: number; height: number; guides: DragGuideState; violatesMargins: boolean } {
  const { width: pw, height: ph } = viewportPt ?? pageDimensionsPt(page)
  const gs = opts.gridSize
  let w = width
  let h = height
  const guides: DragGuideState = { vertical: [], horizontal: [] }

  const right = el.x + w
  const bottom = el.y + h

  const ug = opts.userGuides ?? { vertical: [], horizontal: [] }
  const guidePage: PageSpec = viewportPt
    ? { ...page, margins: { left: 0, right: 0, top: 0, bottom: 0 } }
    : page

  if (opts.smartGuides) {
    const vx = collectVerticalTargets(guidePage, others, pw, ug.vertical)
    let bestR = { dist: ALIGN_THRESH_PT + 1, guide: null as number | null, w: w }
    for (const g of vx) {
      const d = Math.abs(right - g)
      if (d < bestR.dist) bestR = { dist: d, guide: g, w: g - el.x }
    }
    if (bestR.guide != null && bestR.dist <= ALIGN_THRESH_PT && bestR.w >= 20) {
      w = bestR.w
      guides.vertical.push(bestR.guide)
    }

    const hy = collectHorizontalTargets(guidePage, others, ph, ug.horizontal)
    let bestB = { dist: ALIGN_THRESH_PT + 1, guide: null as number | null, h: h }
    for (const g of hy) {
      const d = Math.abs(bottom - g)
      if (d < bestB.dist) bestB = { dist: d, guide: g, h: g - el.y }
    }
    if (bestB.guide != null && bestB.dist <= ALIGN_THRESH_PT && bestB.h >= 16) {
      h = bestB.h
      guides.horizontal.push(bestB.guide)
    }
  }

  if (opts.snapToGrid) {
    if (!guides.vertical.length) w = snap(w, gs)
    if (!guides.horizontal.length) h = snap(h, gs)
  }

  const beforeW = w
  const beforeH = h
  const fin = viewportPt
    ? finalizeResizeSizeInBandViewport(el, w, h, viewportPt.width, viewportPt.height, opts.snapToGrid, gs)
    : finalizeResizeSize(el, w, h, page, opts.snapToGrid, gs)
  w = fin.width
  h = fin.height

  const violatesMargins = viewportPt
    ? isResizeOutsideBandViewport(el, beforeW, beforeH, viewportPt.width, viewportPt.height)
    : isResizeOutsidePrintMargins(el, beforeW, beforeH, page)

  return { width: w, height: h, guides, violatesMargins }
}

/** Header/footer band: use the full band box; do not inset by document print margins. */
function bandViewportInnerBounds(vw: number, vh: number) {
  return { minX: 0, maxX: vw, minY: 0, maxY: vh, vw, vh }
}

function finalizeDragPositionInBandViewport(
  el: LayoutElement,
  nx: number,
  ny: number,
  vw: number,
  vh: number,
  snapToGrid: boolean,
  gridSize?: number
): { x: number; y: number } {
  const { minX, maxX, minY, maxY } = bandViewportInnerBounds(vw, vh)
  let x = nx
  let y = ny
  for (let i = 0; i < 4; i++) {
    const maxLeftX = maxX - el.width
    const maxLeftY = maxY - el.height
    const cx = maxLeftX >= minX ? Math.max(minX, Math.min(maxLeftX, x)) : minX
    const cy = maxLeftY >= minY ? Math.max(minY, Math.min(maxLeftY, y)) : minY
    x = snap(cx, gridSize)
    y = snap(cy, gridSize)
    if (!snapToGrid) break
  }
  return { x, y }
}

function finalizeResizeSizeInBandViewport(
  el: LayoutElement,
  width: number,
  height: number,
  vw: number,
  vh: number,
  snapToGrid: boolean,
  gridSize?: number
): { width: number; height: number } {
  const { maxX, maxY } = bandViewportInnerBounds(vw, vh)
  const minW = 20
  const minH = 16
  let w = width
  let h = height
  for (let i = 0; i < 4; i++) {
    const maxW = Math.max(minW, maxX - el.x)
    const maxH = Math.max(minH, maxY - el.y)
    w = Math.max(minW, Math.min(maxW, w))
    h = Math.max(minH, Math.min(maxH, h))
    if (!snapToGrid) break
    const sw = snap(w, gridSize)
    const sh = snap(h, gridSize)
    if (sw === w && sh === h) break
    w = sw
    h = sh
  }
  return { width: w, height: h }
}

function isOutsideBandViewport(
  el: Pick<LayoutElement, 'width' | 'height'>,
  x: number,
  y: number,
  vw: number,
  vh: number
): boolean {
  const { minX, maxX, minY, maxY } = bandViewportInnerBounds(vw, vh)
  const r = x + el.width
  const b = y + el.height
  return x < minX - 0.5 || y < minY - 0.5 || r > maxX + 0.5 || b > maxY + 0.5
}

function isResizeOutsideBandViewport(
  el: Pick<LayoutElement, 'x' | 'y'>,
  width: number,
  height: number,
  vw: number,
  vh: number
): boolean {
  return isOutsideBandViewport({ ...el, width, height }, el.x, el.y, vw, vh)
}
