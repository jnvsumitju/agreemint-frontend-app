import { useEffect, useMemo } from 'react'
import { useDrag, useDrop } from 'react-dnd'
import { useEditorStore } from '../../stores/editorStore'
import { pageDimensionsPt, type LayoutDocumentPage, type LayoutElement } from '../../types/layout'
import { parseContentToRuns } from '../../lib/richContent'
import { DND_PAGE_REORDER, type PageReorderDragItem } from './dndTypes'

/**
 * Full-canvas page rearranger. Active when `editorStore.rearrangeMode`
 * is true. Renders every page in the document as a draggable thumbnail
 * laid out in a 4-column grid. Drop one tile onto another → the source
 * page moves to that target position via `reorderPages`. Page-local
 * variables move with their owning page object, so cross-page variable
 * references remain bound correctly after the swap.
 *
 * Each thumbnail is a pixel-scaled static preview — same layout math as
 * the live canvas (elements positioned at their pt coordinates inside
 * a scaled container), but no interactions: no select, no edit, no
 * margin-marker drag. The user's only action in this mode is "pick up
 * a page and drop it somewhere else."
 *
 * Press Escape, click "Done", or toggle the toolbar Rearrange button
 * again to exit.
 */
export function RearrangePagesView() {
  const pages = useEditorStore((s) => s.pages)
  const pageSpec = useEditorStore((s) => s.pageSpec)
  const reorderPages = useEditorStore((s) => s.reorderPages)
  const setRearrangeMode = useEditorStore((s) => s.setRearrangeMode)
  const setActivePageIndex = useEditorStore((s) => s.setActivePageIndex)

  // Esc to exit — matches the "modal-feeling" UX even though we're not
  // technically a modal. Bind once and clean up on unmount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRearrangeMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setRearrangeMode])

  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-zinc-100 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-700 dark:bg-zinc-900">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Rearrange pages
          </h2>
          <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">
            Drag a page tile to reorder. Variables stay bound to their owning page after the move.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRearrangeMode(false)}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          title="Exit rearrange (Esc)"
        >
          Done
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {pages.map((page, idx) => (
            <PageTile
              key={page.id}
              page={page}
              pageIndex={idx}
              pageSpec={pageSpec}
              onMove={(from, to) => reorderPages(from, to)}
              onClickJumpTo={() => {
                setActivePageIndex(idx)
                setRearrangeMode(false)
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function PageTile({
  page,
  pageIndex,
  pageSpec,
  onMove,
  onClickJumpTo,
}: {
  page: LayoutDocumentPage
  pageIndex: number
  pageSpec: ReturnType<typeof useEditorStore.getState>['pageSpec']
  onMove: (from: number, to: number) => void
  onClickJumpTo: () => void
}) {
  const dims = useMemo(() => pageDimensionsPt(pageSpec), [pageSpec])
  // Tile is rendered at a fixed visual width (~220px); compute the
  // scale that fits the source page width into that target. Using a
  // scaled inner container keeps the elements at their real pt
  // coordinates and just shrinks them for the preview.
  const TILE_WIDTH_PX = 220
  const scale = TILE_WIDTH_PX / dims.width
  const tileHeight = dims.height * scale

  const [{ isDragging }, dragRef] = useDrag<PageReorderDragItem, void, { isDragging: boolean }>(
    () => ({
      type: DND_PAGE_REORDER,
      item: { type: DND_PAGE_REORDER, fromIndex: pageIndex },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [pageIndex]
  )

  const [{ isOver, canDrop }, dropRef] = useDrop<
    PageReorderDragItem,
    void,
    { isOver: boolean; canDrop: boolean }
  >(
    () => ({
      accept: DND_PAGE_REORDER,
      canDrop: (item) => item.fromIndex !== pageIndex,
      drop: (item) => {
        if (item.fromIndex !== pageIndex) onMove(item.fromIndex, pageIndex)
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }),
    [pageIndex, onMove]
  )

  const setRef = (el: HTMLDivElement | null) => {
    dragRef(el)
    dropRef(el)
  }

  const dropHighlight = isOver && canDrop
    ? 'ring-4 ring-violet-400'
    : isDragging
      ? 'opacity-40'
      : 'hover:ring-2 hover:ring-violet-300'

  return (
    <div
      ref={setRef}
      onDoubleClick={onClickJumpTo}
      className={`group cursor-move overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-sm transition-all dark:border-zinc-600 dark:bg-zinc-100 ${dropHighlight}`}
      title={`${page.name || `Page ${pageIndex + 1}`} — drag to reorder, double-click to jump to this page`}
      style={{ width: TILE_WIDTH_PX }}
    >
      <div className="relative" style={{ width: TILE_WIDTH_PX, height: tileHeight }}>
        <div
          className="absolute left-0 top-0 origin-top-left bg-white"
          style={{
            width: dims.width,
            height: dims.height,
            transform: `scale(${scale})`,
          }}
        >
          {page.elements.map((el) => (
            <ThumbnailElement key={el.id} el={el} />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50 px-3 py-2 dark:border-zinc-200 dark:bg-zinc-50">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Page {pageIndex + 1}
          </div>
          <div className="truncate text-[12px] font-medium text-zinc-800">
            {page.name || `Page ${pageIndex + 1}`}
          </div>
        </div>
        <div className="text-[10px] text-zinc-500">
          {page.elements.length} {page.elements.length === 1 ? 'el' : 'els'}
        </div>
      </div>
    </div>
  )
}

/**
 * Static preview of one element inside the thumbnail. Renders text
 * elements as their plain-text content (clipped + ellipsed); shapes,
 * images, lines, and tables render as gray boxes labelled by type.
 * No interactions, no inline editing, no rich-text rendering.
 */
function ThumbnailElement({ el }: { el: LayoutElement }) {
  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: el.x,
    top: el.y,
    width: el.width,
    height: el.height,
  }
  if (el.type === 'TEXT' || el.type === 'HEADER' || el.type === 'FOOTER' || el.type === 'FLOATING') {
    let text = ''
    if (typeof el.content === 'string') {
      try {
        const runs = parseContentToRuns(el.content)
        text = runs
          .map((r) => (r.type === 'text' ? r.text ?? '' : r.type === 'var' ? `{${r.name}}` : ''))
          .join('')
          .trim()
      } catch {
        /* fall through */
      }
    }
    return (
      <div
        style={{
          ...baseStyle,
          fontSize: el.style?.fontSize ?? 12,
          fontWeight: el.style?.bold ? 700 : 400,
          fontStyle: el.style?.italic ? 'italic' : 'normal',
          color: el.style?.color ?? '#374151',
          lineHeight: 1.3,
          overflow: 'hidden',
          textAlign: el.style?.align ?? 'left',
        }}
      >
        {text}
      </div>
    )
  }
  if (el.type === 'IMAGE') {
    return (
      <div
        style={{
          ...baseStyle,
          backgroundColor: '#e5e7eb',
          backgroundImage: el.src ? `url(${el.src})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
    )
  }
  if (el.type === 'LINE') {
    return (
      <div
        style={{
          ...baseStyle,
          backgroundColor: el.style?.color ?? '#64748b',
        }}
      />
    )
  }
  if (el.type === 'TABLE' || el.type === 'LIST') {
    return (
      <div
        style={{
          ...baseStyle,
          border: '1px solid #d4d4d8',
          backgroundColor: '#fafafa',
        }}
      />
    )
  }
  // Shapes (BOX/ELLIPSE/etc) — render the fill colour.
  return (
    <div
      style={{
        ...baseStyle,
        backgroundColor: el.style?.backgroundColor ?? '#e5e7eb',
        border: el.style?.color ? `1px solid ${el.style.color}` : undefined,
      }}
    />
  )
}
