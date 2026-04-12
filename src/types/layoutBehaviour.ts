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
}
