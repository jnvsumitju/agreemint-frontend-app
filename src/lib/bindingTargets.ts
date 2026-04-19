/**
 * Registry describing every {@link BindingTarget}:
 *  - human label + group
 *  - value type (so the UI picks a number / color / enum input)
 *  - unit hint (pt / ° / %)
 *  - which element types are allowed to bind it
 *
 * The {@link BindingTarget} enum lives in `types/layoutBehaviour.ts`; this
 * file is the user-facing lookup table used by the new Rules editor. Keep
 * both in sync when adding a target — TypeScript will surface a mismatch
 * thanks to the `Record<BindingTarget, TargetSpec>` signature below.
 */
import type { ElementType } from '../types/layout'
import type { BindingTarget } from '../types/layoutBehaviour'

/** Which kind of input the UI should render to capture a literal value. */
export type TargetValueKind = 'number' | 'color' | 'lineStyle' | 'textAlign' | 'fontFamily' | 'imageUrl'

/** Ordered groups — used by the property dropdown as section headers. */
export type TargetGroup =
  | 'Layout'
  | 'Stroke'
  | 'Fill'
  | 'Visual'
  | 'Border'
  | 'Shadow'
  | 'Text'
  | 'Image'

export interface TargetSpec {
  /** Short human label shown in the property dropdown. */
  label: string
  /** Section header in the dropdown. */
  group: TargetGroup
  /** What input to render for the "Fixed" literal mode. */
  valueKind: TargetValueKind
  /** Appended after a number input (`pt`, `°`, `%`, etc.). */
  unit?: string
  /** Sensible default for "Scale variable" multiplier, if the target is numeric. */
  defaultMultiplier?: number
  /**
   * Valid literal values for enum-typed targets. Also used by the
   * mapping editor's "to" dropdown.
   */
  enumValues?: string[]
  /** Element types that may bind this target. Missing means every type. */
  allowedFor?: readonly ElementType[]
}

/** Every element type in one pile — used when a target is universal. */
const EVERY_ELEMENT: readonly ElementType[] = [
  'TEXT', 'HEADER', 'FOOTER', 'TABLE', 'IMAGE', 'LINE', 'BOX', 'ELLIPSE',
  'TRIANGLE', 'ARROW', 'DIAMOND', 'STAR', 'RING', 'MERGED_SHAPE', 'LIST',
]

/** Shape elements (have stroke + fill). */
const SHAPES: readonly ElementType[] = [
  'LINE', 'BOX', 'ELLIPSE', 'TRIANGLE', 'ARROW', 'DIAMOND', 'STAR', 'RING',
  'MERGED_SHAPE',
]

/** Text-ish containers. */
const TEXTS: readonly ElementType[] = ['TEXT', 'HEADER', 'FOOTER']

/** BOX / IMAGE / TABLE support explicit borders + rounded corners. */
const BOXY: readonly ElementType[] = ['BOX', 'IMAGE', 'TABLE']

/**
 * Registry. The `Record<BindingTarget, TargetSpec>` signature means adding
 * a new target in the enum without registering it here is a compile error.
 */
export const BINDING_TARGETS: Record<BindingTarget, TargetSpec> = {
  // ── Layout ────────────────────────────────────────────────────────────
  x: { label: 'X position', group: 'Layout', valueKind: 'number', unit: 'pt', defaultMultiplier: 1 },
  y: { label: 'Y position', group: 'Layout', valueKind: 'number', unit: 'pt', defaultMultiplier: 1 },
  width: { label: 'Width', group: 'Layout', valueKind: 'number', unit: 'pt', defaultMultiplier: 100 },
  height: { label: 'Height', group: 'Layout', valueKind: 'number', unit: 'pt', defaultMultiplier: 100 },

  // ── Stroke ────────────────────────────────────────────────────────────
  strokeWidth: {
    label: 'Stroke width', group: 'Stroke', valueKind: 'number', unit: 'pt',
    defaultMultiplier: 1, allowedFor: SHAPES,
  },
  strokeColor: {
    label: 'Stroke color', group: 'Stroke', valueKind: 'color',
    allowedFor: [...SHAPES, ...TEXTS],
  },
  lineStyle: {
    label: 'Line style', group: 'Stroke', valueKind: 'lineStyle',
    enumValues: ['solid', 'dashed', 'dotted'],
    allowedFor: [...SHAPES, ...BOXY],
  },

  // ── Fill ──────────────────────────────────────────────────────────────
  fillColor: {
    label: 'Fill color', group: 'Fill', valueKind: 'color',
    allowedFor: [...SHAPES, ...BOXY, ...TEXTS],
  },

  // ── Visual ────────────────────────────────────────────────────────────
  opacity: {
    label: 'Opacity', group: 'Visual', valueKind: 'number', unit: '%',
    defaultMultiplier: 100,
  },
  rotation: {
    label: 'Rotation', group: 'Visual', valueKind: 'number', unit: '°',
    defaultMultiplier: 1,
  },

  // ── Border (BOX / IMAGE / TABLE) ─────────────────────────────────────
  borderRadius: {
    label: 'Border radius', group: 'Border', valueKind: 'number', unit: 'pt',
    defaultMultiplier: 1, allowedFor: BOXY,
  },
  borderWidth: {
    label: 'Border width', group: 'Border', valueKind: 'number', unit: 'pt',
    defaultMultiplier: 1, allowedFor: BOXY,
  },

  // ── Shadow (four independent targets) ────────────────────────────────
  shadowX: { label: 'Shadow X offset', group: 'Shadow', valueKind: 'number', unit: 'pt', defaultMultiplier: 1 },
  shadowY: { label: 'Shadow Y offset', group: 'Shadow', valueKind: 'number', unit: 'pt', defaultMultiplier: 1 },
  shadowBlur: { label: 'Shadow blur', group: 'Shadow', valueKind: 'number', unit: 'pt', defaultMultiplier: 1 },
  shadowColor: { label: 'Shadow color', group: 'Shadow', valueKind: 'color' },

  // ── Text ──────────────────────────────────────────────────────────────
  // TABLE counts as text-bearing for this target — cells read `style.color`
  // for their text fill, same as TEXT/HEADER/FOOTER.
  textColor: { label: 'Text color', group: 'Text', valueKind: 'color', allowedFor: [...TEXTS, 'TABLE'] },
  fontSize: { label: 'Font size', group: 'Text', valueKind: 'number', unit: 'pt', defaultMultiplier: 12, allowedFor: TEXTS },
  fontFamily: { label: 'Font family', group: 'Text', valueKind: 'fontFamily', allowedFor: TEXTS },
  lineHeight: { label: 'Line height', group: 'Text', valueKind: 'number', defaultMultiplier: 1.4, allowedFor: TEXTS },
  textAlign: {
    label: 'Text alignment', group: 'Text', valueKind: 'textAlign',
    // ElementStyle.align only supports these three — justify isn't a
    // runtime option so it stays off the list.
    enumValues: ['left', 'center', 'right'],
    allowedFor: TEXTS,
  },

  // ── Image ─────────────────────────────────────────────────────────────
  imageSrc: {
    label: 'Image URL', group: 'Image', valueKind: 'imageUrl',
    allowedFor: ['IMAGE'],
  },
}

/** Returns the targets a given element type is allowed to bind, preserving
 *  the registry's insertion order so the property dropdown reads
 *  top-to-bottom: Layout → Stroke → Fill → Visual → Border → Shadow →
 *  Text → Image. */
export function targetsForElementType(type: ElementType): BindingTarget[] {
  return (Object.keys(BINDING_TARGETS) as BindingTarget[]).filter((t) => {
    const allowed = BINDING_TARGETS[t].allowedFor ?? EVERY_ELEMENT
    return allowed.includes(type)
  })
}

/** Group targets for rendering as `<optgroup>`s in the property dropdown. */
export function groupedTargetsForElementType(
  type: ElementType,
): Array<{ group: TargetGroup; targets: BindingTarget[] }> {
  const allowed = targetsForElementType(type)
  const byGroup = new Map<TargetGroup, BindingTarget[]>()
  for (const t of allowed) {
    const g = BINDING_TARGETS[t].group
    const arr = byGroup.get(g) ?? []
    arr.push(t)
    byGroup.set(g, arr)
  }
  return Array.from(byGroup.entries()).map(([group, targets]) => ({ group, targets }))
}
