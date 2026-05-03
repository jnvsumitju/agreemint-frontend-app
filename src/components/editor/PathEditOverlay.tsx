/**
 * Renders the interactive chrome for path-edit mode — vertex handles,
 * bezier control-handle dots + connector lines, an insertion-preview
 * marker on the edge under the cursor, and magenta smart-guide lines
 * during a drag. Mounted inside the page-coord container in
 * {@link EditorCanvas}, so all positions below are in document pt (the
 * container handles the zoom scale).
 *
 * Two-tier interaction model:
 *
 *   • Polygon-only shapes (the Phase-1 default):
 *       - pointerdown on a vertex handle → move anchor
 *       - click on the dashed outline → insert a corner vertex
 *
 *   • Bezier shapes (first introduced by Alt-dragging any vertex):
 *       - pointerdown on a vertex handle → move anchor
 *       - Alt + pointerdown on a vertex handle → pull out symmetric
 *         control handles (promotes polygon→bezier on the fly if it
 *         hadn't been curved yet)
 *       - pointerdown on a control-handle diamond → reshape curve;
 *         smooth vertices keep the opposite handle mirrored
 *       - Alt + pointerdown on a control handle → break smooth, drag
 *         only the one side
 *       - double-click a vertex handle → toggle smooth ↔ corner
 *       - click on the dashed outline → split the nearest curve
 *         segment at the clicked point (De Casteljau)
 *
 * Renders nothing when no element is being path-edited, so it's cheap
 * to mount unconditionally.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { pageDimensionsPt } from '../../types/layout'
import { useEditorStore } from '../../stores/editorStore'
import {
  applySnap,
  collectSnapTargets,
  movePointInPolys,
  nearestPointOnRing,
  snapTo45,
  snapToGrid,
  type PathVertexRef,
  type SnapGuide,
} from '../../lib/pathEditing'
import {
  bezierPathToSvgPathD,
  cloneBezierPath,
  nearestPointOnBezierRing,
} from '../../lib/bezierGeometry'
import type { ShapeBezierMultiPath } from '../../types/layout'

const HANDLE_RADIUS_PT = 4
const CONTROL_HANDLE_RADIUS_PT = 3
const OVERLAY_PADDING_PT = HANDLE_RADIUS_PT * 2

export function PathEditOverlay() {
  const pathEditingElementId = useEditorStore((s) => s.pathEditingElementId)
  const pathEditingSelectedVertex = useEditorStore((s) => s.pathEditingSelectedVertex)
  const smartGuides = useEditorStore((s) => s.pathEditingSmartGuides)
  const activePageIndex = useEditorStore((s) => s.activePageIndex)
  const pages = useEditorStore((s) => s.pages)
  const canvasZoom = useEditorStore((s) => s.canvasZoom)
  const gridSize = useEditorStore((s) => s.gridSize)
  const snapToGridEnabled = useEditorStore((s) => s.snapToGrid)
  const pageSpec = useEditorStore((s) => s.pageSpec)
  const smartGuidesEnabled = useEditorStore((s) => s.smartGuidesEnabled)
  // Vertex handles get a "Click to select · Delete to remove" tooltip
  // only when the global Hints toggle (status bar) is on. Same gating as
  // the floating element-hint strip elsewhere — keeps the overlay clean
  // for users who already know the keystrokes.
  const showEditorHints = useEditorStore((s) => s.showEditorHints)

  const selectPathVertex = useEditorStore((s) => s.selectPathVertex)
  const updatePathShape = useEditorStore((s) => s.updatePathShape)
  const updatePathBezier = useEditorStore((s) => s.updatePathBezier)
  const upgradePathToBezier = useEditorStore((s) => s.upgradePathToBezier)
  const insertPathVertex = useEditorStore((s) => s.insertPathVertex)
  const insertPathBezierVertex = useEditorStore((s) => s.insertPathBezierVertex)
  const setBezierVertexHandles = useEditorStore((s) => s.setBezierVertexHandles)
  const toggleBezierVertexSmooth = useEditorStore((s) => s.toggleBezierVertexSmooth)
  const setPathEditingSmartGuides = useEditorStore((s) => s.setPathEditingSmartGuides)
  const beginHistoryBatch = useEditorStore((s) => s.beginHistoryBatch)
  const endHistoryBatch = useEditorStore((s) => s.endHistoryBatch)

  const elements = pages[activePageIndex]?.elements ?? []
  const editingEl = pathEditingElementId
    ? elements.find((e) => e.id === pathEditingElementId)
    : undefined

  const otherElements = useMemo(
    () => elements.filter((e) => e.id !== pathEditingElementId),
    [elements, pathEditingElementId],
  )

  const { width: PAGE_W, height: PAGE_H } = useMemo(() => pageDimensionsPt(pageSpec), [pageSpec])

  // All hooks declared before any conditional early return so React's
  // hook ordering invariant is respected.
  const overlayRef = useRef<HTMLDivElement>(null)
  const [edgeHover, setEdgeHover] = useState<
    | { polyIndex: number; ringIndex: number; localX: number; localY: number }
    | null
  >(null)
  // `anchorDragRef` backs vertex-anchor drags; `ctrlDragRef` backs
  // control-handle drags. Kept separate so one doesn't clobber the
  // other mid-gesture.
  const anchorDragRef = useRef<{
    ref: PathVertexRef
    pointerId: number
    mode: 'move' | 'pullout'
    startClientX: number
    startClientY: number
    anchorWorldX: number
    anchorWorldY: number
    shiftAnchor: { x: number; y: number } | null
    // For 'pullout': the bezier snapshot we're mutating. The first
    // move locks the upgrade in (dispatches `upgradePathToBezier`).
    upgradedOnce: boolean
  } | null>(null)
  const ctrlDragRef = useRef<{
    ref: PathVertexRef
    side: 'in' | 'out'
    pointerId: number
    startClientX: number
    startClientY: number
    baseOffset: [number, number]
    // When true, this drag broke smoothness — the store call skips
    // mirroring for the duration of the drag.
    breakSmooth: boolean
  } | null>(null)

  useEffect(() => {
    return () => {
      if (anchorDragRef.current || ctrlDragRef.current) {
        endHistoryBatch()
        anchorDragRef.current = null
        ctrlDragRef.current = null
      }
    }
  }, [pathEditingElementId, endHistoryBatch])

  if (!editingEl || editingEl.type !== 'MERGED_SHAPE') return null

  const bezierPath = editingEl.bezierPath
  const polys = editingEl.shapePolys
  if (!bezierPath?.length && !polys?.length) return null

  const isBezier = !!bezierPath?.length
  const originX = editingEl.x
  const originY = editingEl.y

  const clientToLocal = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const node = overlayRef.current
    if (!node) return null
    const rect = node.getBoundingClientRect()
    const px = (clientX - rect.left) / canvasZoom
    const py = (clientY - rect.top) / canvasZoom
    return { x: px - OVERLAY_PADDING_PT, y: py - OVERLAY_PADDING_PT }
  }

  /* ── Vertex (anchor) drag ─────────────────────────────────────────── */

  const onAnchorPointerDown = (ref: PathVertexRef) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    // Look up the anchor's current position from whichever source of
    // truth is active.
    const anchor = getAnchorLocal(editingEl.bezierPath, editingEl.shapePolys, ref)
    if (!anchor) return

    // Sibling anchor (previous in ring) for Shift-angle-lock.
    const prev = getPrevAnchorLocal(editingEl.bezierPath, editingEl.shapePolys, ref)
    const prevWorld = prev ? { x: prev.x + originX, y: prev.y + originY } : null

    anchorDragRef.current = {
      ref,
      pointerId: e.pointerId,
      mode: e.altKey ? 'pullout' : 'move',
      startClientX: e.clientX,
      startClientY: e.clientY,
      anchorWorldX: anchor.x + originX,
      anchorWorldY: anchor.y + originY,
      shiftAnchor: prevWorld,
      upgradedOnce: false,
    }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    selectPathVertex(ref)
    beginHistoryBatch()
  }

  const onAnchorPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = anchorDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    e.preventDefault()
    const dxCss = e.clientX - drag.startClientX
    const dyCss = e.clientY - drag.startClientY
    const dxPt = dxCss / canvasZoom
    const dyPt = dyCss / canvasZoom

    if (drag.mode === 'pullout') {
      // Alt-drag: first delta upgrades polygon → bezier if needed, and
      // pulls out symmetric handles pointing in the drag direction. The
      // anchor position itself stays put; only the handles change.
      if (!drag.upgradedOnce) {
        if (!useEditorStore.getState().pages[activePageIndex]?.elements.find(
          (x) => x.id === pathEditingElementId,
        )?.bezierPath?.length) {
          upgradePathToBezier()
        }
        drag.upgradedOnce = true
      }
      // `out` handle points in the drag direction; `in` mirrors.
      const out: [number, number] = [dxPt, dyPt]
      setBezierVertexHandles(
        drag.ref,
        { cpOut: out, smooth: true, mirrorWhenSmooth: true },
        { skipHistory: true },
      )
      return
    }

    // Plain drag: move the anchor with snapping. Uses the same smart-
    // guide pipeline as the polygon path.
    let wx = drag.anchorWorldX + dxPt
    let wy = drag.anchorWorldY + dyPt
    if (e.shiftKey && drag.shiftAnchor) {
      const locked = snapTo45(wx, wy, drag.shiftAnchor)
      wx = locked.x
      wy = locked.y
    }
    if (snapToGridEnabled && gridSize > 0) {
      const g = snapToGrid(wx, wy, gridSize)
      wx = g.x
      wy = g.y
    }
    let guides: SnapGuide[] = []
    if (smartGuidesEnabled) {
      // Build snap targets. Treat the current polygon shadow (always
      // present) as the authoritative sibling-vertex source.
      const targets = collectSnapTargets({
        editingElement: editingEl,
        editingPolys: editingEl.shapePolys ?? [],
        excludeRef: drag.ref,
        otherElements,
      })
      const snapped = applySnap(wx, wy, targets, 4)
      wx = snapped.x
      wy = snapped.y
      guides = snapped.guides
    }
    const localX = wx - originX
    const localY = wy - originY

    if (isBezier) {
      const nextPath = cloneBezierPath(editingEl.bezierPath!)
      const ring = nextPath[drag.ref.polyIndex]?.[drag.ref.ringIndex]
      const vertex = ring?.[drag.ref.pointIndex]
      if (vertex) {
        vertex.p = [localX, localY]
        updatePathBezier(nextPath, { skipHistory: true })
      }
    } else if (polys) {
      const nextPolys = movePointInPolys(polys, drag.ref, localX, localY)
      updatePathShape(nextPolys, { skipHistory: true })
    }

    setPathEditingSmartGuides({
      vertical: guides.filter((g) => g.orientation === 'vertical').map((g) => g.value),
      horizontal: guides.filter((g) => g.orientation === 'horizontal').map((g) => g.value),
    })
  }

  const onAnchorPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = anchorDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    anchorDragRef.current = null
    endHistoryBatch()
    setPathEditingSmartGuides({ vertical: [], horizontal: [] })
  }

  const onAnchorDoubleClick = (ref: PathVertexRef) => (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    toggleBezierVertexSmooth(ref)
  }

  /* ── Control-handle drag ──────────────────────────────────────────── */

  const onCtrlPointerDown =
    (ref: PathVertexRef, side: 'in' | 'out', baseOffset: [number, number]) =>
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      ctrlDragRef.current = {
        ref,
        side,
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        baseOffset: [baseOffset[0], baseOffset[1]],
        breakSmooth: e.altKey,
      }
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      beginHistoryBatch()
    }

  const onCtrlPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = ctrlDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    e.preventDefault()
    const dxPt = (e.clientX - drag.startClientX) / canvasZoom
    const dyPt = (e.clientY - drag.startClientY) / canvasZoom
    const nextOffset: [number, number] = [drag.baseOffset[0] + dxPt, drag.baseOffset[1] + dyPt]
    setBezierVertexHandles(
      drag.ref,
      {
        [drag.side === 'in' ? 'cpIn' : 'cpOut']: nextOffset,
        // Break smoothness permanently if Alt was held at drag start.
        smooth: drag.breakSmooth ? false : undefined,
        mirrorWhenSmooth: !drag.breakSmooth,
      },
      { skipHistory: true },
    )
  }

  const onCtrlPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = ctrlDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    ctrlDragRef.current = null
    endHistoryBatch()
  }

  /* ── SVG outline: click-to-insert + hover preview ─────────────────── */

  const onPathClick =
    (polyIndex: number, ringIndex: number) =>
    (e: React.MouseEvent<SVGPathElement>) => {
      e.stopPropagation()
      const local = clientToLocal(e.clientX, e.clientY)
      if (!local) return
      if (isBezier && bezierPath) {
        const ring = bezierPath[polyIndex]?.[ringIndex]
        if (!ring) return
        const hit = nearestPointOnBezierRing(ring, local.x, local.y)
        if (!hit) return
        insertPathBezierVertex(polyIndex, ringIndex, hit.segmentIndex, hit.t)
        return
      }
      if (polys) {
        const ring = polys[polyIndex]?.[ringIndex]
        if (!ring) return
        const hit = nearestPointOnRing(ring, local.x, local.y)
        if (!hit) return
        insertPathVertex(polyIndex, ringIndex, hit.segmentIndex, hit.x, hit.y)
      }
    }

  const onPathMove =
    (polyIndex: number, ringIndex: number) =>
    (e: React.MouseEvent<SVGPathElement>) => {
      const local = clientToLocal(e.clientX, e.clientY)
      if (!local) {
        setEdgeHover(null)
        return
      }
      if (isBezier && bezierPath) {
        const ring = bezierPath[polyIndex]?.[ringIndex]
        if (!ring) return
        const hit = nearestPointOnBezierRing(ring, local.x, local.y)
        if (!hit) return
        setEdgeHover({ polyIndex, ringIndex, localX: hit.x, localY: hit.y })
        return
      }
      if (polys) {
        const ring = polys[polyIndex]?.[ringIndex]
        if (!ring) return
        const hit = nearestPointOnRing(ring, local.x, local.y)
        if (!hit) return
        setEdgeHover({ polyIndex, ringIndex, localX: hit.x, localY: hit.y })
      }
    }
  const onPathLeave = () => setEdgeHover(null)

  /* ── Layout ───────────────────────────────────────────────────────── */

  const boxLeft = originX - OVERLAY_PADDING_PT
  const boxTop = originY - OVERLAY_PADDING_PT
  const boxW = editingEl.width + OVERLAY_PADDING_PT * 2
  const boxH = editingEl.height + OVERLAY_PADDING_PT * 2

  // Build the overlay outline `d`. For bezier we mirror the main render
  // path (true curves); for polygon we keep per-ring paths so each ring
  // has its own click-to-insert hit target.
  const bezierOverlayD = isBezier && bezierPath ? bezierPathToSvgPathD(bezierPath) : ''

  // Iterate over whichever source is authoritative so handle positions
  // match the rendered outline exactly. For bezier: anchor = vertex.p.
  // For polygon: point = ring[i], drop the trailing wrap-around dup.
  const anchors = isBezier ? bezierAnchors(bezierPath!) : polygonAnchors(polys!)

  // Control handles for the *selected* bezier vertex only. Hides them
  // when no vertex is selected to keep the canvas clean.
  const selectedBezierVertex =
    isBezier && pathEditingSelectedVertex
      ? bezierPath![pathEditingSelectedVertex.polyIndex]?.[pathEditingSelectedVertex.ringIndex]?.[
          pathEditingSelectedVertex.pointIndex
        ]
      : null
  const selectedAnchorLocal = isBezier && pathEditingSelectedVertex
    ? bezierPath![pathEditingSelectedVertex.polyIndex]?.[pathEditingSelectedVertex.ringIndex]?.[
        pathEditingSelectedVertex.pointIndex
      ]?.p
    : null

  return (
    <>
      {/* Smart-guide lines — span the whole page. */}
      {smartGuides.vertical.map((x) => (
        <div
          key={`path-vg-${x}`}
          className="pointer-events-none absolute z-[26] w-px bg-fuchsia-500/80 dark:bg-fuchsia-400/80"
          style={{ left: x, top: 0, height: PAGE_H }}
        />
      ))}
      {smartGuides.horizontal.map((y) => (
        <div
          key={`path-hg-${y}`}
          className="pointer-events-none absolute left-0 z-[26] h-px bg-fuchsia-500/80 dark:bg-fuchsia-400/80"
          style={{ top: y, width: PAGE_W }}
        />
      ))}

      <div
        ref={overlayRef}
        className="pointer-events-none absolute z-[36]"
        style={{ left: boxLeft, top: boxTop, width: boxW, height: boxH }}
      >
        {/* Outline + insertion preview. When bezier, one <path> for the
            whole multi-path (curves); when polygon, one per ring so the
            hit test can pinpoint which ring was clicked. */}
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          viewBox={`${-OVERLAY_PADDING_PT} ${-OVERLAY_PADDING_PT} ${boxW} ${boxH}`}
        >
          {isBezier && bezierPath ? (
            bezierPath.map((poly, pi) =>
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              poly.map((_ring, ri) => (
                <path
                  key={`b-${pi}-${ri}`}
                  d={bezierOverlayD}
                  /* One `d` for all rings is fine — the hit test knows
                     which ring it's on from the (pi, ri) closure args. */
                  fill="none"
                  stroke="rgb(139 92 246)"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                  style={{ pointerEvents: 'stroke', cursor: 'copy' }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={onPathClick(pi, ri)}
                  onMouseMove={onPathMove(pi, ri)}
                  onMouseLeave={onPathLeave}
                />
              )),
            )
          ) : polys ? (
            polys.map((poly, pi) =>
              poly.map((ring, ri) => (
                <path
                  key={`p-${pi}-${ri}`}
                  d={ringPolyToPathD(ring)}
                  fill="none"
                  stroke="rgb(139 92 246)"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                  style={{ pointerEvents: 'stroke', cursor: 'copy' }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={onPathClick(pi, ri)}
                  onMouseMove={onPathMove(pi, ri)}
                  onMouseLeave={onPathLeave}
                />
              )),
            )
          ) : null}

          {/* Connector lines between the selected vertex and its control
              handles. Drawn in the SVG layer so they scale right. */}
          {selectedBezierVertex && selectedAnchorLocal && (
            <>
              {selectedBezierVertex.cpIn && (
                <line
                  x1={selectedAnchorLocal[0]}
                  y1={selectedAnchorLocal[1]}
                  x2={selectedAnchorLocal[0] + selectedBezierVertex.cpIn[0]}
                  y2={selectedAnchorLocal[1] + selectedBezierVertex.cpIn[1]}
                  stroke="rgb(139 92 246)"
                  strokeWidth={0.8}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {selectedBezierVertex.cpOut && (
                <line
                  x1={selectedAnchorLocal[0]}
                  y1={selectedAnchorLocal[1]}
                  x2={selectedAnchorLocal[0] + selectedBezierVertex.cpOut[0]}
                  y2={selectedAnchorLocal[1] + selectedBezierVertex.cpOut[1]}
                  stroke="rgb(139 92 246)"
                  strokeWidth={0.8}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </>
          )}

          {edgeHover && (
            <circle
              cx={edgeHover.localX}
              cy={edgeHover.localY}
              r={HANDLE_RADIUS_PT * 0.7}
              fill="rgb(139 92 246)"
              stroke="white"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}
        </svg>

        {/* Vertex (anchor) handles — circles. Squared-off when the
            vertex is a corner with no handles to hint its type; filled
            violet when selected. */}
        {anchors.map((a) => {
          const selected =
            pathEditingSelectedVertex?.polyIndex === a.ref.polyIndex &&
            pathEditingSelectedVertex?.ringIndex === a.ref.ringIndex &&
            pathEditingSelectedVertex?.pointIndex === a.ref.pointIndex
          return (
            <div
              key={`h-${a.ref.polyIndex}-${a.ref.ringIndex}-${a.ref.pointIndex}`}
              role="button"
              aria-label={`Vertex ${a.ref.pointIndex + 1}`}
              aria-pressed={selected}
              title={showEditorHints ? 'Click to select · Delete to remove' : undefined}
              className={`pointer-events-auto absolute rounded-full border-2 transition-colors ${
                selected
                  ? 'border-violet-700 bg-violet-500 dark:border-violet-300'
                  : 'border-violet-600 bg-white hover:bg-violet-100 dark:bg-zinc-800 dark:hover:bg-zinc-700'
              }`}
              style={{
                left: a.x + OVERLAY_PADDING_PT - HANDLE_RADIUS_PT,
                top: a.y + OVERLAY_PADDING_PT - HANDLE_RADIUS_PT,
                width: HANDLE_RADIUS_PT * 2,
                height: HANDLE_RADIUS_PT * 2,
                cursor: 'grab',
                touchAction: 'none',
              }}
              onPointerDown={onAnchorPointerDown(a.ref)}
              onPointerMove={onAnchorPointerMove}
              onPointerUp={onAnchorPointerUp}
              onPointerCancel={onAnchorPointerUp}
              onDoubleClick={onAnchorDoubleClick(a.ref)}
            />
          )
        })}

        {/* Control-handle diamonds for the selected bezier vertex. */}
        {selectedBezierVertex && selectedAnchorLocal && pathEditingSelectedVertex && (
          <>
            {selectedBezierVertex.cpIn && (
              <ControlHandleDot
                localX={selectedAnchorLocal[0] + selectedBezierVertex.cpIn[0]}
                localY={selectedAnchorLocal[1] + selectedBezierVertex.cpIn[1]}
                onPointerDown={onCtrlPointerDown(
                  pathEditingSelectedVertex,
                  'in',
                  selectedBezierVertex.cpIn,
                )}
                onPointerMove={onCtrlPointerMove}
                onPointerUp={onCtrlPointerUp}
              />
            )}
            {selectedBezierVertex.cpOut && (
              <ControlHandleDot
                localX={selectedAnchorLocal[0] + selectedBezierVertex.cpOut[0]}
                localY={selectedAnchorLocal[1] + selectedBezierVertex.cpOut[1]}
                onPointerDown={onCtrlPointerDown(
                  pathEditingSelectedVertex,
                  'out',
                  selectedBezierVertex.cpOut,
                )}
                onPointerMove={onCtrlPointerMove}
                onPointerUp={onCtrlPointerUp}
              />
            )}
          </>
        )}
      </div>
    </>
  )
}

/** Small diamond-shaped control-handle dot. Extracted because we render
 *  up to two of these (in + out) with identical styling. */
function ControlHandleDot({
  localX,
  localY,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  localX: number
  localY: number
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      className="pointer-events-auto absolute rotate-45 border-2 border-violet-600 bg-white dark:bg-zinc-800"
      style={{
        left: localX + OVERLAY_PADDING_PT - CONTROL_HANDLE_RADIUS_PT,
        top: localY + OVERLAY_PADDING_PT - CONTROL_HANDLE_RADIUS_PT,
        width: CONTROL_HANDLE_RADIUS_PT * 2,
        height: CONTROL_HANDLE_RADIUS_PT * 2,
        cursor: 'grab',
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  )
}

/* ── Helpers — anchor enumeration + lookups across both schemas ────── */

interface AnchorRef {
  x: number
  y: number
  ref: PathVertexRef
}

function bezierAnchors(path: ShapeBezierMultiPath): AnchorRef[] {
  const out: AnchorRef[] = []
  path.forEach((poly, pi) => {
    poly.forEach((ring, ri) => {
      ring.forEach((v, pti) => {
        out.push({
          x: v.p[0],
          y: v.p[1],
          ref: { polyIndex: pi, ringIndex: ri, pointIndex: pti },
        })
      })
    })
  })
  return out
}

function polygonAnchors(polys: NonNullable<import('../../types/layout').ShapeMultiPolygon>): AnchorRef[] {
  const out: AnchorRef[] = []
  polys.forEach((poly, pi) => {
    poly.forEach((ring, ri) => {
      // Strip the trailing wrap-around dup so it's not a draggable
      // handle on top of the ring's first vertex.
      const pts =
        ring.length > 2 &&
        Math.abs(ring[0]![0] - ring[ring.length - 1]![0]) < 1e-6 &&
        Math.abs(ring[0]![1] - ring[ring.length - 1]![1]) < 1e-6
          ? ring.slice(0, -1)
          : ring
      pts.forEach((pt, pti) => {
        out.push({
          x: pt[0],
          y: pt[1],
          ref: { polyIndex: pi, ringIndex: ri, pointIndex: pti },
        })
      })
    })
  })
  return out
}

function getAnchorLocal(
  bezier: ShapeBezierMultiPath | undefined,
  polys: NonNullable<import('../../types/layout').ShapeMultiPolygon> | undefined,
  ref: PathVertexRef,
): { x: number; y: number } | null {
  if (bezier?.length) {
    const v = bezier[ref.polyIndex]?.[ref.ringIndex]?.[ref.pointIndex]
    return v ? { x: v.p[0], y: v.p[1] } : null
  }
  if (polys?.length) {
    const p = polys[ref.polyIndex]?.[ref.ringIndex]?.[ref.pointIndex]
    return p ? { x: p[0], y: p[1] } : null
  }
  return null
}

function getPrevAnchorLocal(
  bezier: ShapeBezierMultiPath | undefined,
  polys: NonNullable<import('../../types/layout').ShapeMultiPolygon> | undefined,
  ref: PathVertexRef,
): { x: number; y: number } | null {
  if (bezier?.length) {
    const ring = bezier[ref.polyIndex]?.[ref.ringIndex]
    if (!ring || ring.length === 0) return null
    const prev = ring[(ref.pointIndex - 1 + ring.length) % ring.length]
    return prev ? { x: prev.p[0], y: prev.p[1] } : null
  }
  if (polys?.length) {
    const ring = polys[ref.polyIndex]?.[ref.ringIndex]
    if (!ring || ring.length === 0) return null
    const prev = ring[(ref.pointIndex - 1 + ring.length) % ring.length]
    return prev ? { x: prev[0], y: prev[1] } : null
  }
  return null
}

function ringPolyToPathD(ring: NonNullable<import('../../types/layout').ShapeMultiPolygon>[0][0]): string {
  if (ring.length < 2) return ''
  const pts =
    ring.length > 2 &&
    Math.abs(ring[0]![0] - ring[ring.length - 1]![0]) < 1e-6 &&
    Math.abs(ring[0]![1] - ring[ring.length - 1]![1]) < 1e-6
      ? ring.slice(0, -1)
      : ring
  if (pts.length < 2) return ''
  let d = `M ${pts[0]![0]} ${pts[0]![1]}`
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i]![0]} ${pts[i]![1]}`
  }
  return `${d} Z`
}
