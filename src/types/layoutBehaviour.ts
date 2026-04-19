/**
 * Data-driven element behaviour (visibility, conditional colors, size, table rules).
 * Resolved identically in the editor (TS) and PDF (Java).
 */
export type BehaviourConditionOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'defined'

/** `left` / `right` may be literals or `{{dotted.path}}` placeholders (substituted from data). */
export interface BehaviourCondition {
  left: string | number | boolean
  op: BehaviourConditionOp
  /** Ignored for `defined`. For `in`, comma-separated string or JSON array string after substitution. */
  right?: string | number | boolean
}

export interface BehaviourVisibilityRule {
  when: BehaviourCondition
  show: boolean
}

export interface BehaviourColorRule {
  when: BehaviourCondition
  /** Maps to ElementStyle.color (stroke / text / line). */
  strokeColor?: string
  /** Maps to ElementStyle.backgroundColor (fill / text frame / image backdrop). */
  fillColor?: string
}

export interface BehaviourSizeBinding {
  /** Expression: number, `{{path}}`, + - * / ( ), min(,), max(,), clamp(n,lo,hi). */
  widthExpr?: string
  heightExpr?: string
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
}

export type TextOverflowMode = 'clip' | 'ellipsis' | 'shrinkToFit'

export interface BehaviourTextOverflow {
  mode: TextOverflowMode
  minFontSize?: number
}

export interface BehaviourTableRowRule {
  when: BehaviourCondition
  /** When true and condition matches, omit this data row in PDF/table preview. */
  hide?: boolean
}

export interface BehaviourTableCellRule {
  when: BehaviourCondition
  /** Zero-based column index. */
  colIndex: number
  textColor?: string
  backgroundColor?: string
}

export interface BehaviourTable {
  rowRules?: BehaviourTableRowRule[]
  cellRules?: BehaviourTableCellRule[]
}

export function parseElementBehaviour(raw: unknown): ElementBehaviour | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  return raw as ElementBehaviour
}

export interface ElementBehaviour {
  behaviourVersion?: number
  /** First matching rule wins; if none match, `visibilityDefaultShow` (default true). */
  visibilityRules?: BehaviourVisibilityRule[]
  visibilityDefaultShow?: boolean
  /** First matching rule wins; later rules do not stack. */
  colorRules?: BehaviourColorRule[]
  size?: BehaviourSizeBinding
  textOverflow?: BehaviourTextOverflow
  /** If set, replaces `src` after `{{}}` substitution (editor + PDF). */
  imageSrcExpr?: string
  table?: BehaviourTable
  /**
   * Unified rules list — the new format. When present, rules are evaluated
   * in order and override/compose the legacy `visibilityRules` /
   * `colorRules` / `size` fields above. During the migration window, both
   * may coexist on the same element; the legacy fields remain the source of
   * truth for the Java PDF renderer until it's updated.
   */
  rules?: Rule[]
}

// ─── Unified rules (new model) ──────────────────────────────────────────────
//
// A single list of sentence-shaped rules replaces the three separate
// visibility / color / size sections. The v1 editor still writes the
// legacy fields; the v2 editor (coming next phase) will write `rules`.
// The resolver already knows how to evaluate either.

/**
 * What a rule can set or do. Visibility is expressed as {@link HideAction} /
 * {@link ShowAction} so the list is one homogeneous pipeline.
 */
export type RuleAction =
  | { kind: 'hide' }
  | { kind: 'show' }
  | { kind: 'set'; target: BindingTarget; value: RuleValue }

/**
 * Which element field a `set` action writes to. Grouped here for:
 *   - UI dropdowns (via the bindingTargets registry)
 *   - Type-aware value coercion (number / color / enum)
 *   - Element-type compatibility filtering
 */
export type BindingTarget =
  // Layout
  | 'x' | 'y' | 'width' | 'height'
  // Stroke
  | 'strokeWidth' | 'strokeColor' | 'lineStyle'
  // Fill
  | 'fillColor'
  // Visual
  | 'opacity' | 'rotation'
  // Border (BOX / IMAGE / TABLE)
  | 'borderRadius' | 'borderWidth'
  // Shadow — four independent targets so each is a simple picker
  | 'shadowX' | 'shadowY' | 'shadowBlur' | 'shadowColor'
  // Text-only
  | 'textColor' | 'fontSize' | 'fontFamily' | 'lineHeight' | 'textAlign'
  // Image-only
  | 'imageSrc'

/**
 * Five modes covering virtually every rule people write. The UI's segmented
 * control presents them in ease-of-use order so "Custom formula" is the
 * last choice, not the default.
 */
export type RuleValue =
  /** Plain literal — number, hex, enum keyword. */
  | { mode: 'fixed'; value: string | number }
  /** Pass-through of a variable's value (optionally typecast). */
  | { mode: 'variable'; var: string }
  /**
   * `var * multiplier` clamped to `[min, max]`. Covers the common
   * `clamp({{var}}*200, 20, 200)` pattern without needing a formula.
   */
  | { mode: 'scaled'; var: string; multiplier: number; min?: number; max?: number }
  /**
   * Switch-case: pick a value from a lookup table keyed off a variable.
   * Falls back to {@link fallback} when no case matches.
   */
  | {
      mode: 'mapping'
      var: string
      cases: MappingCase[]
      fallback?: string | number
    }
  /** Escape hatch — free-form expression (same grammar as legacy `widthExpr`). */
  | { mode: 'expression'; expression: string }

export interface MappingCase {
  match: string | number
  value: string | number
}

/**
 * Condition tree — single comparison leaves, AND / OR branches. Nested
 * groups let users express `(A AND B) OR C` from day one.
 */
export type Condition =
  | { kind: 'compare'; left: string; op: BehaviourConditionOp; right?: string | number | boolean }
  | { kind: 'all'; of: Condition[] }
  | { kind: 'any'; of: Condition[] }

export interface Rule {
  id: string
  /** Disabled rules are skipped but preserved in JSON — useful for
   *  temporarily toggling without losing authorial intent. */
  enabled?: boolean
  /** Omit for "always applies". */
  when?: Condition
  action: RuleAction
}
