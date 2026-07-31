import { usePlan } from '../../hooks/usePlan'
import { useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useDrag } from 'react-dnd'
import {
  Combine as IconUnionLucide,
  Group as IconGroupLucide,
  PenTool as IconEditPathLucide,
  SquaresExclude as IconDivideLucide,
  Ungroup as IconUngroupLucide,
  Unlink2 as IconUnmergeLucide,
} from 'lucide-react'
import type { ElementType } from '../../types/layout'
import type { EditorCanvasTool } from '../../stores/editorStore'
import { useEditorStore } from '../../stores/editorStore'
import { canDivideSelection, canUnionSelection, isMergeableShapeType } from '../../lib/shapeGeometry'
import { DND_COMPONENT, DND_NEW, type LayoutComponentDragItem, type NewElementDragItem } from './dndTypes'
import type { SavedLayoutComponent } from '../../lib/savedLayoutComponents'
import { PagesSection } from './PagesSection'
import { EmptyState } from '../ui/EmptyState'
import { Tooltip } from './ui/Tooltip'

const BLOCKS: { type: ElementType; label: string }[] = [
  { type: 'TEXT', label: 'Text' },
  { type: 'HEADER', label: 'Header' },
  { type: 'FOOTER', label: 'Footer' },
  { type: 'FLOATING', label: 'Floating' },
  { type: 'TABLE', label: 'Table' },
  { type: 'LIST', label: 'List' },
  { type: 'IMAGE', label: 'Image' },
]

// Triangle / Diamond / Star / Ring are intentionally absent.
//   • Triangle, Diamond → unified "Polygon" tile (sides=3 → triangle,
//     sides=4 → diamond, sides=5+ → pentagon, hexagon, …).
//   • Star → the user can draw one via path-edit (double-click any
//     polygon and freely place vertices), or build one with boolean ops.
//   • Ring → built from two ellipses + Subtract / Divide in the Actions
//     palette. Stored layouts that still hold STAR / RING elements keep
//     rendering via their legacy element-type branches.
const SHAPES: { type: ElementType; label: string }[] = [
  { type: 'LINE', label: 'Line' },
  { type: 'BOX', label: 'Box' },
  { type: 'ELLIPSE', label: 'Ellipse' },
  { type: 'POLYGON', label: 'Polygon' },
  { type: 'ARROW', label: 'Arrow' },
]

const TOOLS: {
  id: EditorCanvasTool
  title: string
  Icon: () => ReactElement
}[] = [
  {
    id: 'select',
    title: 'Select — click to select, double-click text to edit',
    Icon: IconSelect,
  },
  {
    id: 'move',
    title: 'Move — drag elements without a long press (or hold Space)',
    Icon: IconMove,
  },
  {
    id: 'draw',
    title: 'Place — choose a block below, then click the page',
    Icon: IconPlace,
  },
  {
    id: 'pan',
    title: 'Pan — drag the canvas to scroll',
    Icon: IconPan,
  },
  {
    id: 'rotate',
    title: 'Rotate — select an element, then drag on the canvas to rotate it',
    Icon: IconRotate,
  },
]

function IconSelect() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 4l7.07 17 2.51-7.39 7.39-2.51L4 4z" strokeLinejoin="round" />
    </svg>
  )
}

function IconMove() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M19 9l3 3-3 3M9 19l3 3 3-3M2 12h20M12 2v20" strokeLinecap="round" />
    </svg>
  )
}

function IconPlace() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  )
}

function IconPan() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 11V6a2 2 0 0 0-4 0v5" />
      <path d="M14 10V4a2 2 0 0 0-4 0v10" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  )
}

function IconMagicWand() {
  // Wand + sparkle — reads as "AI generate this for me".
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14.5 9.5L4 20" />
      <path d="M14.5 9.5l5-5" />
      <path d="M13 8l3 3" />
      <path d="M19 13l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z" fill="currentColor" stroke="none" />
      <path d="M8 4l.7 1.4L10 6l-1.3.6L8 8l-.7-1.4L6 6l1.3-.6L8 4z" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconRotate() {
  // Circular-arrow — commonly read as "rotate" in design tools.
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 11-3.1-6.8L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  )
}

// Action icons come from lucide-react — designed to fill the viewBox tightly
// at consistent stroke weight, so they read clearly in the small ActionTile
// buttons. Local wrappers fix render size + stroke so every icon is uniform
// and we can swap one icon without touching the rest.
const ACTION_ICON_SIZE = 22

function IconGroup() {
  return <IconGroupLucide size={ACTION_ICON_SIZE} strokeWidth={1.75} aria-hidden />
}

function IconUngroup() {
  return <IconUngroupLucide size={ACTION_ICON_SIZE} strokeWidth={1.75} aria-hidden />
}

function IconUnion() {
  return <IconUnionLucide size={ACTION_ICON_SIZE} strokeWidth={1.75} aria-hidden />
}

function IconDivide() {
  return <IconDivideLucide size={ACTION_ICON_SIZE} strokeWidth={1.75} aria-hidden />
}

function IconEditPath() {
  return <IconEditPathLucide size={ACTION_ICON_SIZE} strokeWidth={1.75} aria-hidden />
}

function IconUnmerge() {
  return <IconUnmergeLucide size={ACTION_ICON_SIZE} strokeWidth={1.75} aria-hidden />
}

function ActionToolButton({
  title,
  disabled,
  disabledReason,
  onClick,
  children,
}: {
  title: string
  disabled: boolean
  /**
   * Shown in the tooltip + aria-label when the button is disabled — tells
   * the user *why* (e.g. "Select 2+ shapes") instead of repeating the
   * action name back to them. Falls back to plain {@code title} when not
   * provided so existing callers keep working.
   */
  disabledReason?: string
  onClick: () => void
  children: React.ReactNode
}) {
  const effectiveTitle = disabled && disabledReason ? `${title} — ${disabledReason}` : title
  return (
    <button
      type="button"
      title={effectiveTitle}
      aria-label={effectiveTitle}
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault()
        if (!disabled) onClick()
      }}
      className={`flex h-11 w-full items-center justify-center rounded-md border transition-colors lg:h-12 ${
        disabled
          ? 'cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-500'
          : 'border-zinc-200 bg-white text-zinc-600 hover:border-violet-400 hover:bg-violet-50 hover:text-violet-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-violet-500 dark:hover:bg-violet-950/50 dark:hover:text-violet-200'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * Wraps an {@link ActionToolButton} with a small caption below at lg+.
 * The caption stays hidden at smaller breakpoints (where the palette is
 * narrow and we keep the icon-only grid). CollapsedActions deliberately
 * does NOT use this wrapper — it shows tooltips on hover instead.
 */
function ActionTile({
  caption,
  title,
  disabled,
  disabledReason,
  onClick,
  children,
}: {
  caption: string
  title: string
  disabled: boolean
  disabledReason?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <ActionToolButton
        title={title}
        disabled={disabled}
        disabledReason={disabledReason}
        onClick={onClick}
      >
        {children}
      </ActionToolButton>
      <span
        className={`hidden lg:block text-[10px] leading-tight whitespace-nowrap ${
          disabled ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-600 dark:text-zinc-300'
        }`}
      >
        {caption}
      </span>
    </div>
  )
}

function useActionStates() {
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const pages = useEditorStore((s) => s.pages)
  const activePageIndex = useEditorStore((s) => s.activePageIndex)
  const bandNestedEditorMounted = useEditorStore((s) => s.bandNestedEditorMounted)
  const viewOnly = useEditorStore((s) => s.viewOnly)
  const elements = pages[activePageIndex]?.elements ?? []

  const multiSelected = selectedIds.length >= 2
  const anyGrouped = elements.some((e) => selectedIds.includes(e.id) && e.groupId)
  // Divide and Union share the same precondition: ≥2 selected unlocked
  // mergeable shapes. They're exposed separately so future behaviour
  // tweaks (e.g. requiring actual overlap for Divide) can be targeted.
  const canDivide = canDivideSelection({ selectedIds, elements })
  const canUnion = canUnionSelection({ selectedIds, elements })

  const singleEl = selectedIds.length === 1 ? elements.find((e) => e.id === selectedIds[0]) : undefined
  const canUnmerge = !!(singleEl?.type === 'MERGED_SHAPE' && singleEl.mergedFromElements?.length)
  // Path-edit mode opens on a single mergeable unlocked shape. Disabled
  // while already editing so the button doesn't re-enter and reset the
  // current vertex selection.
  const canEditPath = !!(
    singleEl &&
    !singleEl.locked &&
    isMergeableShapeType(singleEl.type)
  )

  return {
    canGroup: !viewOnly && !bandNestedEditorMounted && multiSelected,
    canUngroup: !viewOnly && !bandNestedEditorMounted && anyGrouped,
    canDivide: !viewOnly && canDivide,
    canUnion: !viewOnly && canUnion,
    canUnmerge: !viewOnly && canUnmerge,
    canEditPath: !viewOnly && canEditPath,
  }
}

function BlockIcon({ type }: { type: ElementType }) {
  const c = 'text-current'
  switch (type) {
    case 'TEXT':
      return (
        <svg className={c} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M4 6h16M4 12h10M4 18h14" strokeLinecap="round" />
        </svg>
      )
    case 'HEADER':
      return (
        <svg className={c} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="3" y="4" width="18" height="6" rx="1" />
          <path d="M5 14h14M5 18h10" strokeLinecap="round" />
        </svg>
      )
    case 'FOOTER':
      return (
        <svg className={c} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M5 6h14M5 10h10" strokeLinecap="round" />
          <rect x="3" y="14" width="18" height="6" rx="1" />
        </svg>
      )
    case 'FLOATING':
      return (
        <svg className={c} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="14" height="14" rx="1" strokeDasharray="2 2" opacity="0.6" />
          <rect x="9" y="9" width="12" height="10" rx="1" fill="currentColor" fillOpacity="0.12" />
        </svg>
      )
    case 'TABLE':
      return (
        <svg className={c} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="4" y="4" width="16" height="16" rx="1" />
          <path d="M4 9h16M4 14h16M9 4v16M14 4v16" />
        </svg>
      )
    case 'LIST':
      return (
        <svg className={c} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="5" cy="6" r="1.5" fill="currentColor" stroke="none" />
          <path d="M10 6h10" strokeLinecap="round" />
          <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
          <path d="M10 12h10" strokeLinecap="round" />
          <circle cx="5" cy="18" r="1.5" fill="currentColor" stroke="none" />
          <path d="M10 18h10" strokeLinecap="round" />
        </svg>
      )
    case 'IMAGE':
      return (
        <svg className={c} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="3" y="5" width="18" height="14" rx="1" />
          <path d="M8 14l3-3 4 4 3-5 3 4" strokeLinejoin="round" />
        </svg>
      )
    case 'LINE':
      return (
        <svg className={c} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
          <path d="M4 12h16" strokeLinecap="round" />
        </svg>
      )
    case 'BOX':
      return (
        // Solid stroke to match the new "solid by default" lineStyle for
        // newly-placed Box elements. The legacy dashed icon was a relic of
        // the old `lineStyle: 'dashed'` default — removing it here so the
        // palette tile previews what the user will actually get on drop.
        <svg className={c} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="4" y="4" width="16" height="16" rx="1" />
        </svg>
      )
    case 'ELLIPSE':
      return (
        <svg className={c} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <ellipse cx="12" cy="12" rx="7" ry="5" />
        </svg>
      )
    case 'TRIANGLE':
      return (
        <svg className={c} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M12 4L20 18H4L12 4z" strokeLinejoin="round" />
        </svg>
      )
    case 'POLYGON':
      // Pentagon glyph — distinct from triangle (3) and diamond (4),
      // signals to the user that this tile creates an n-gon they can
      // re-side from the props panel.
      return (
        <svg className={c} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M12 3l9 6.5-3.4 10.5H6.4L3 9.5 12 3z" strokeLinejoin="round" />
        </svg>
      )
    case 'ARROW':
      return (
        <svg className={c} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M4 12h10M14 12l-3-3m3 3l-3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'DIAMOND':
      return (
        <svg className={c} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M12 3l8 9-8 9-8-9 8-9z" strokeLinejoin="round" />
        </svg>
      )
    case 'STAR':
      return (
        <svg className={c} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path
            d="M12 2l2.2 6.8H21l-5.5 4 2.1 6.7L12 15.8 6.4 19.5l2.1-6.7L3 8.8h6.8L12 2z"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'MERGED_SHAPE':
      return (
        <svg className={c} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M5 8l4-3 5 4-2 6H7L5 8z" strokeLinejoin="round" />
        </svg>
      )
    case 'RING':
      return (
        <svg className={c} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      )
    default:
      return (
        <svg className={c} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="5" y="5" width="14" height="14" rx="1" />
        </svg>
      )
  }
}

function ToolButton({
  tool,
  title,
  Icon,
}: {
  tool: EditorCanvasTool
  title: string
  Icon: () => ReactElement
}) {
  const canvasTool = useEditorStore((s) => s.canvasTool)
  const setCanvasTool = useEditorStore((s) => s.setCanvasTool)
  const active = canvasTool === tool
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      aria-label={title.split('—')[0]?.trim() ?? title}
      onClick={() => setCanvasTool(tool)}
      className={`flex h-8 items-center justify-center rounded-md border transition-colors ${
        active
          ? 'border-violet-600 bg-violet-50 text-violet-800 dark:border-violet-500 dark:bg-violet-950/50 dark:text-violet-200'
          : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-500'
      }`}
    >
      <Icon />
    </button>
  )
}

/**
 * Magic-wand button — opens the AI generation modal. Sits alongside the
 * canvas tools but doesn't toggle a canvas mode; it's just a trigger. Tinted
 * violet/fuchsia to read as "do something special" vs the neutral tools.
 */
function AiToolButton({ title }: { title: string }) {
  const navigate = useNavigate()
  const { atLeast } = usePlan()
  // AI drafting is Starter and up. Kept visible rather than hidden — this is
  // the most compelling thing to upgrade for, so clicking routes to billing.
  const aiAllowed = atLeast('STARTER')
  const setAiModalOpen = useEditorStore((s) => s.setAiModalOpen)
  const aiGenerating = useEditorStore((s) => s.aiGenerating)
  const aiPendingSnapshot = useEditorStore((s) => s.aiPendingSnapshot)
  const disabled = aiGenerating || aiPendingSnapshot != null
  return (
    <button
      type="button"
      title={aiAllowed ? title : 'AI drafting is available on Starter and above'}
      aria-label="Generate with AI"
      disabled={disabled}
      onClick={() => {
        // AI is Starter and up; the server returns 402 regardless.
        if (!aiAllowed) { navigate('/settings?tab=billing'); return }
        setAiModalOpen(true)
      }}
      className={`flex h-8 items-center justify-center rounded-md border transition-colors ${
        disabled
          ? 'cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-500'
          : 'border-fuchsia-300 bg-gradient-to-br from-fuchsia-50 to-violet-50 text-fuchsia-700 hover:border-fuchsia-500 hover:from-fuchsia-100 hover:to-violet-100 dark:border-fuchsia-700 dark:from-fuchsia-950/40 dark:to-violet-950/40 dark:text-fuchsia-200'
      }`}
    >
      <IconMagicWand />
    </button>
  )
}

/**
 * Toggle the multi-page Rearrange grid view. When active, the side
 * panels and format bar collapse and the canvas becomes a 4-column
 * draggable thumbnail grid so the author can reorder pages quickly.
 * Disabled while there's only one page (nothing to rearrange).
 */
function RearrangeToolButton({ title }: { title: string }) {
  const rearrangeMode = useEditorStore((s) => s.rearrangeMode)
  const setRearrangeMode = useEditorStore((s) => s.setRearrangeMode)
  const pageCount = useEditorStore((s) => s.pages.length)
  const disabled = pageCount < 2 && !rearrangeMode
  return (
    <button
      type="button"
      title={title}
      aria-label="Rearrange pages"
      aria-pressed={rearrangeMode}
      disabled={disabled}
      onClick={() => setRearrangeMode(!rearrangeMode)}
      className={`flex h-8 items-center justify-center rounded-md border transition-colors ${
        disabled
          ? 'cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-500'
          : rearrangeMode
            ? 'border-violet-600 bg-violet-50 text-violet-800 dark:border-violet-500 dark:bg-violet-950/50 dark:text-violet-200'
            : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-500'
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    </button>
  )
}

function PaletteRow({
  elementType,
  label,
}: {
  elementType: ElementType
  label: string
}) {
  const bandNestedEditorMounted = useEditorStore((s) => s.bandNestedEditorMounted)
  const viewOnly = useEditorStore((s) => s.viewOnly)
  const disabledInBand =
    bandNestedEditorMounted && (elementType === 'HEADER' || elementType === 'FOOTER')
  const disabled = viewOnly || disabledInBand

  const [{ isDragging }, drag] = useDrag<NewElementDragItem, void, { isDragging: boolean }>(
    () => ({
      type: DND_NEW,
      item: { type: DND_NEW, elementType },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
      canDrag: () => {
        const st = useEditorStore.getState()
        if (st.viewOnly) return false
        if (!st.bandNestedEditorMounted) return true
        return elementType !== 'HEADER' && elementType !== 'FOOTER'
      },
    }),
    [elementType]
  )

  const placementElementType = useEditorStore((s) => s.placementElementType)
  const setPlacementElementType = useEditorStore((s) => s.setPlacementElementType)
  const canvasTool = useEditorStore((s) => s.canvasTool)
  const drawActive = canvasTool === 'draw'
  const selectedForPlace = placementElementType === elementType && !disabledInBand

  const baseTitle =
    drawActive && !disabled
      ? `${label} — click page to place (or drag)`
      : `${label} — drag to page · sets type for Place tool`
  const title = viewOnly
    ? `${label} — view-only mode`
    : disabledInBand
      ? `${label} — not available while editing header or footer`
      : baseTitle

  return (
    <div
      ref={(node) => {
        if (!viewOnly) drag(node)
      }}
      role="listitem"
      aria-disabled={disabled}
      onClick={() => {
        if (disabled) return
        setPlacementElementType(elementType)
      }}
      title={title}
      className={`flex min-h-[2.75rem] flex-col items-center justify-center gap-0.5 rounded-md border px-0.5 py-1 text-center text-[9px] font-medium leading-tight transition-colors lg:min-h-[3.5rem] lg:px-1 lg:py-1.5 lg:text-[10px] ${
        disabled
          ? 'cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-500'
          : `cursor-grab active:cursor-grabbing ${
              isDragging ? 'opacity-50' : ''
            } ${
              drawActive && selectedForPlace
                ? 'border-violet-500 bg-violet-50 text-violet-900 dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-100'
                : 'border-zinc-200 bg-white text-zinc-800 hover:border-violet-300 hover:bg-violet-50/80 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:border-violet-500'
            }`
      }`}
    >
      <span className="shrink-0 opacity-80">
        <BlockIcon type={elementType} />
      </span>
      <span className="w-full break-words hyphens-auto">{label}</span>
    </div>
  )
}

function ComponentPaletteRow({ component }: { component: SavedLayoutComponent }) {
  const [{ isDragging }, drag] = useDrag<LayoutComponentDragItem, void, { isDragging: boolean }>(
    () => ({
      type: DND_COMPONENT,
      item: { type: DND_COMPONENT, componentId: component.id },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [component.id]
  )
  const removeLayoutComponent = useEditorStore((s) => s.removeLayoutComponent)
  const n = component.elements.length

  return (
    <div
      ref={(node) => {
        drag(node)
      }}
      className={`flex cursor-grab items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-left text-[11px] font-medium text-zinc-800 transition-colors hover:border-violet-300 hover:bg-violet-50/80 active:cursor-grabbing dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:border-violet-500 ${
        isDragging ? 'opacity-50' : ''
      }`}
      title={`${component.name} — ${n} element${n === 1 ? '' : 's'} · drag onto page`}
    >
      <span className="min-w-0 flex-1 truncate">{component.name}</span>
      <span className="shrink-0 text-[9px] font-normal text-zinc-400 dark:text-zinc-500">{n}</span>
      <button
        type="button"
        className="shrink-0 rounded px-1 text-zinc-400 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-950/50 dark:hover:text-red-300"
        title="Remove component"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          removeLayoutComponent(component.id)
        }}
      >
        ×
      </button>
    </div>
  )
}

function ActionsSection() {
  const { canGroup, canUngroup, canDivide, canUnion, canUnmerge, canEditPath } = useActionStates()
  const groupSelection = useEditorStore((s) => s.groupSelection)
  const ungroupSelection = useEditorStore((s) => s.ungroupSelection)
  const divideSelectionIntoRegions = useEditorStore((s) => s.divideSelectionIntoRegions)
  const unionSelectionIntoMergedShape = useEditorStore((s) => s.unionSelectionIntoMergedShape)
  const unmergeSelection = useEditorStore((s) => s.unmergeSelection)
  const enterPathEditMode = useEditorStore((s) => s.enterPathEditMode)
  const selectedIds = useEditorStore((s) => s.selectedIds)

  // Single 3-column grid: row 1 covers the "selection-as-collection" ops
  // (Group/Ungroup) plus the lone vector op (Edit points); row 2 holds the
  // boolean trio (Union/Divide/Unmerge). Group↔Ungroup stay horizontally
  // adjacent and the boolean ops cluster together so muscle memory still
  // works without the explicit family labels.
  return (
    <div>
      <p className="mb-1 text-[8px] font-semibold uppercase tracking-wide text-zinc-500 lg:text-[10px] dark:text-zinc-400">Actions</p>
      <div className="grid grid-cols-3 gap-1.5">
        <ActionTile
          caption="Group"
          title="Group"
          disabled={!canGroup}
          disabledReason="Select 2 or more elements"
          onClick={groupSelection}
        >
          <IconGroup />
        </ActionTile>
        <ActionTile
          caption="Ungroup"
          title="Ungroup"
          disabled={!canUngroup}
          disabledReason="Select a grouped element"
          onClick={ungroupSelection}
        >
          <IconUngroup />
        </ActionTile>
        <ActionTile
          caption="Edit points"
          title="Edit points"
          disabled={!canEditPath}
          disabledReason="Select a single shape"
          onClick={() => selectedIds[0] && enterPathEditMode(selectedIds[0])}
        >
          <IconEditPath />
        </ActionTile>
        <ActionTile
          caption="Union"
          title="Union"
          disabled={!canUnion}
          disabledReason="Select 2+ shapes"
          onClick={unionSelectionIntoMergedShape}
        >
          <IconUnion />
        </ActionTile>
        <ActionTile
          caption="Divide"
          title="Divide"
          disabled={!canDivide}
          disabledReason="Select 2+ overlapping shapes"
          onClick={divideSelectionIntoRegions}
        >
          <IconDivide />
        </ActionTile>
        <ActionTile
          caption="Unmerge"
          title="Unmerge"
          disabled={!canUnmerge}
          disabledReason="Select a merged shape"
          onClick={unmergeSelection}
        >
          <IconUnmerge />
        </ActionTile>
      </div>
    </div>
  )
}

function CollapsedActions() {
  const { canGroup, canUngroup, canDivide, canUnion, canUnmerge, canEditPath } = useActionStates()
  const groupSelection = useEditorStore((s) => s.groupSelection)
  const ungroupSelection = useEditorStore((s) => s.ungroupSelection)
  const divideSelectionIntoRegions = useEditorStore((s) => s.divideSelectionIntoRegions)
  const unionSelectionIntoMergedShape = useEditorStore((s) => s.unionSelectionIntoMergedShape)
  const unmergeSelection = useEditorStore((s) => s.unmergeSelection)
  const enterPathEditMode = useEditorStore((s) => s.enterPathEditMode)
  const selectedIds = useEditorStore((s) => s.selectedIds)

  return (
    <div className="flex flex-col gap-1 px-1">
      <Tooltip content="Group" position="right">
        <span className="flex">
          <ActionToolButton title="Group" disabled={!canGroup} onClick={groupSelection}>
            <IconGroup />
          </ActionToolButton>
        </span>
      </Tooltip>
      <Tooltip content="Ungroup" position="right">
        <span className="flex">
          <ActionToolButton title="Ungroup" disabled={!canUngroup} onClick={ungroupSelection}>
            <IconUngroup />
          </ActionToolButton>
        </span>
      </Tooltip>
      <Tooltip content="Union" position="right">
        <span className="flex">
          <ActionToolButton title="Union" disabled={!canUnion} onClick={unionSelectionIntoMergedShape}>
            <IconUnion />
          </ActionToolButton>
        </span>
      </Tooltip>
      <Tooltip content="Divide" position="right">
        <span className="flex">
          <ActionToolButton title="Divide" disabled={!canDivide} onClick={divideSelectionIntoRegions}>
            <IconDivide />
          </ActionToolButton>
        </span>
      </Tooltip>
      <Tooltip content="Edit points" position="right">
        <span className="flex">
          <ActionToolButton
            title="Edit points"
            disabled={!canEditPath}
            onClick={() => selectedIds[0] && enterPathEditMode(selectedIds[0])}
          >
            <IconEditPath />
          </ActionToolButton>
        </span>
      </Tooltip>
      <Tooltip content="Unmerge" position="right">
        <span className="flex">
          <ActionToolButton title="Unmerge" disabled={!canUnmerge} onClick={unmergeSelection}>
            <IconUnmerge />
          </ActionToolButton>
        </span>
      </Tooltip>
    </div>
  )
}

export function LeftPalette() {
  const viewOnly = useEditorStore((s) => s.viewOnly)
  const role = useEditorStore((s) => s.role)
  // Default to 'pages' on first render: the store now starts fail-closed
  // (viewOnly=true, role=null) until /access resolves. The role-based snap
  // below picks the correct tab for the user's actual role once that
  // response lands. Initialising to 'insert' instead would flash editing
  // chrome to a REVIEWER for a few hundred ms.
  const [tab, setTab] = useState<'insert' | 'pages'>('pages')
  const [collapsed, setCollapsed] = useState(false)
  const canvasTool = useEditorStore((s) => s.canvasTool)
  const savedComponents = useEditorStore((s) => s.savedComponents)
  // One-shot: once role resolves, snap to the right default tab. Admin/
  // Designer get Insert & tools; Reviewer/Viewer stay on Pages. After this
  // initial snap, the user's manual tab clicks are respected.
  const initializedFromRole = useRef(false)

  useEffect(() => {
    if (role === null) return
    if (initializedFromRole.current) return
    initializedFromRole.current = true
    setTab(viewOnly ? 'pages' : 'insert')
  }, [role, viewOnly])

  // Safety net for later transitions: if the user flips into view-only mode
  // mid-session (only ADMIN/DESIGNER can — see editorStore.setViewOnly guard)
  // and they were on the Insert tab, snap them to Pages so they aren't
  // looking at a hidden tab.
  useEffect(() => {
    if (viewOnly && tab === 'insert') setTab('pages')
  }, [viewOnly, tab])

  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-zinc-200 bg-white py-1.5 transition-[width] duration-200 dark:border-zinc-700 dark:bg-zinc-900">
        <Tooltip content="Expand sidebar" position="right">
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            onClick={() => setCollapsed(false)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        </Tooltip>
        {!viewOnly && (
          <>
            <div className="w-full border-t border-zinc-100 dark:border-zinc-800" />
            <div className="flex flex-col gap-1 px-1">
              {TOOLS.map(({ id, title, Icon }) => (
                <Tooltip key={id} content={title} position="right">
                  <span><ToolButton tool={id} title={title} Icon={Icon} /></span>
                </Tooltip>
              ))}
              <Tooltip content="Generate with AI — describe the template in plain English" position="right">
                <span><AiToolButton title="Generate with AI" /></span>
              </Tooltip>
              <Tooltip content="Rearrange — drag pages to reorder" position="right">
                <span><RearrangeToolButton title="Rearrange — drag pages to reorder" /></span>
              </Tooltip>
            </div>
            <div className="w-full border-t border-zinc-100 dark:border-zinc-800" />
            <CollapsedActions />
          </>
        )}
      </aside>
    )
  }

  return (
    <aside className="flex w-36 shrink-0 flex-col border-r border-zinc-200 bg-white transition-[width] duration-200 lg:w-[13.5rem] dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex shrink-0 border-b border-zinc-200 dark:border-zinc-700">
        {!viewOnly && (
          <button
            type="button"
            className={`min-w-0 flex-1 px-1 py-1.5 text-[9px] font-semibold leading-tight transition-colors lg:px-1.5 lg:py-2 lg:text-[11px] ${
              tab === 'insert'
                ? 'border-b-2 border-violet-600 text-violet-700 dark:text-violet-300'
                : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
            }`}
            onClick={() => setTab('insert')}
          >
          Insert &amp; tools
        </button>
        )}
        <button
          type="button"
          className={`min-w-0 flex-1 px-1 py-1.5 text-[9px] font-semibold leading-tight transition-colors lg:px-1.5 lg:py-2 lg:text-[11px] ${
            tab === 'pages'
              ? 'border-b-2 border-violet-600 text-violet-700 dark:text-violet-300'
              : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
          onClick={() => setTab('pages')}
        >
          Pages
        </button>
        <button
          type="button"
          title="Collapse sidebar"
          className="flex h-full items-center px-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          onClick={() => setCollapsed(true)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
            <path d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
          </svg>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {tab === 'insert' && !viewOnly ? (
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1 text-[8px] font-semibold uppercase tracking-wide text-zinc-500 lg:text-[10px] dark:text-zinc-400">Tools</p>
              <div className="grid grid-cols-4 gap-1 lg:grid-cols-5">
                {TOOLS.map(({ id, title, Icon }) => (
                  <ToolButton key={id} tool={id} title={title} Icon={Icon} />
                ))}
                <AiToolButton title="Generate with AI — describe in plain English" />
                <RearrangeToolButton title="Rearrange — drag pages to reorder" />
              </div>
              {canvasTool === 'draw' && (
                <p className="mt-1.5 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
                  Pick a block, shape, or saved component, then click the page. Drag still works.
                </p>
              )}
            </div>
            <ActionsSection />
            <div>
              <p className="mb-1 text-[8px] font-semibold uppercase tracking-wide text-zinc-500 lg:text-[10px] dark:text-zinc-400">Blocks</p>
              <p className="mb-1.5 text-[8px] leading-snug text-zinc-500 lg:text-[10px] dark:text-zinc-400">
                Drag onto the page. Row click sets the type for Place.
              </p>
              <div className="grid grid-cols-2 gap-1 lg:grid-cols-3" role="list">
                {BLOCKS.map(({ type, label }) => (
                  <PaletteRow key={type} elementType={type} label={label} />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-[8px] font-semibold uppercase tracking-wide text-zinc-500 lg:text-[10px] dark:text-zinc-400">Shapes</p>
              <p className="mb-1.5 text-[8px] leading-snug text-zinc-500 lg:text-[10px] dark:text-zinc-400">
                Line and box. Same drag / Place behavior as blocks.
              </p>
              <div className="grid grid-cols-2 gap-1 lg:grid-cols-3" role="list">
                {SHAPES.map(({ type, label }) => (
                  <PaletteRow key={type} elementType={type} label={label} />
                ))}
              </div>
            </div>
            {/* SYMBOLS section removed — math + emoji insertion is now
                handled three other ways: the FormatBar buttons that appear
                while inline-editing a textbox, the slash-command typeahead
                inside any TipTap editor, and the contextual reuse of those
                same picker popovers from elsewhere. The dedicated palette
                tiles were redundant and pushed Components further down. */}
            <div>
              <p className="mb-1 text-[8px] font-semibold uppercase tracking-wide text-zinc-500 lg:text-[10px] dark:text-zinc-400">Components</p>
              <p className="mb-1.5 text-[8px] leading-snug text-zinc-500 lg:text-[10px] dark:text-zinc-400">
                Right-click an element or group on the page, then <span className="font-medium">Save as component</span>. Drag a
                saved row here onto the page to insert.
              </p>
              {savedComponents.length === 0 ? (
                <EmptyState
                  title="No components"
                  description="Right-click an element and save as component"
                  className="py-4"
                  icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>}
                />
              ) : (
                <div className="flex flex-col gap-1" role="list">
                  {savedComponents.map((c) => (
                    <ComponentPaletteRow key={c.id} component={c} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <PagesSection />
        )}
      </div>
    </aside>
  )
}
