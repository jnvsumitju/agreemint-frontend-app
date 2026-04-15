import { filterPersistableVariableDefinitions } from '../lib/systemTemplateVariables'
import type { ElementBehaviour } from './layoutBehaviour'
import { parseElementBehaviour } from './layoutBehaviour'

export type ElementType =
  | 'TEXT'
  | 'HEADER'
  | 'FOOTER'
  | 'TABLE'
  | 'IMAGE'
  | 'LINE'
  | 'BOX'
  | 'ELLIPSE'
  | 'TRIANGLE'
  | 'ARROW'
  | 'DIAMOND'
  | 'STAR'
  | 'RING'
  | 'MERGED_SHAPE'
  | 'LIST'

export type ListStyle = 'disc' | 'circle' | 'square' | 'dash' | 'number' | 'alpha' | 'roman' | 'none'

/** A single node in a tree-structured list. */
export interface ListItemNode {
  text: string
  children?: ListItemNode[]
}

/** Polygon ring in layout-local pt. */
export type ShapeRing = [number, number][]
/** One polygon: outer ring then optional holes. */
export type ShapePolygon = ShapeRing[]
/** Disjoint polygons (e.g. boolean union result). */
export type ShapeMultiPolygon = ShapePolygon[]

export interface ElementShadow {
  offsetX: number
  offsetY: number
  blur: number
  color: string
}

/** Single colour stop in a gradient. */
export interface GradientStop {
  /** CSS colour string (hex, rgb, etc.). */
  color: string
  /** Position along gradient axis, 0–1. */
  position: number
}

/** Linear or radial gradient definition. */
export interface GradientDef {
  type: 'linear' | 'radial'
  /** Degrees for linear (0 = top→bottom, 90 = left→right). Ignored for radial. */
  angle?: number
  /** Colour stops, minimum 2. */
  stops: GradientStop[]
}

export interface ElementStyle {
  fontSize?: number
  bold?: boolean
  italic?: boolean
  align?: 'left' | 'center' | 'right'
  /** CSS color (e.g. #0f172a, rgb(15,23,42)). Text for rich text / table cells; stroke for LINE; border for BOX. */
  color?: string
  /** CSS background (rich text blocks, BOX fill, IMAGE backdrop). */
  backgroundColor?: string
  /** CSS font-family, e.g. "Inter", "Georgia". */
  fontFamily?: string
  /** 0–1; default 1 (fully opaque). */
  opacity?: number
  /** Degrees clockwise; default 0. */
  rotation?: number
  /** Border corner radius in pt (BOX, IMAGE, TABLE). */
  borderRadius?: number
  /** Explicit border width in pt (BOX, IMAGE). Distinct from shape strokeWidth on LayoutElement. */
  borderWidth?: number
  /** Stroke / border dash pattern. */
  lineStyle?: 'solid' | 'dashed' | 'dotted'
  /** Line-height multiplier (e.g. 1.0, 1.2, 1.5, 2.0). Default 1.4. */
  lineHeight?: number
  /** CSS-like drop shadow. */
  shadow?: ElementShadow
  /** Gradient for text color / stroke. Takes precedence over `color` when set. */
  colorGradient?: GradientDef
  /** Gradient for background / fill. Takes precedence over `backgroundColor` when set. */
  bgGradient?: GradientDef
}

/** Element-anchored comment / annotation (V1: stored in layout JSON). */
export interface ElementComment {
  id: string
  text: string
  author: string
  createdAt: string
  resolved?: boolean
  /** Threaded replies nested under this comment. */
  replies?: ElementComment[]
}

export interface TableColumn {
  header: string
  key: string
}

/** Per-cell text styling within a table variable's cellStyle array. */
export interface TableCellTextStyle {
  color?: string
  isBold?: boolean
  isItalic?: boolean
  isUnderline?: boolean
  fontSize?: number
  fontFamily?: string
  align?: 'left' | 'center' | 'right'
}

/** Styling for a single cell within the cellStyle 2D array. */
export interface TableCellStyle {
  cellBgColor?: string | null
  cellText?: TableCellTextStyle
}

/** Border configuration for the table variable structure. */
export interface TableBorderStyle {
  width?: number
  color?: string
  style?: 'solid' | 'dashed' | 'dotted' | 'none'
}

/** Structured table variable value (stored as JSON string in variableValues). */
export interface TableVariableData {
  /** 2D array of strings; row 0 is headers, rows 1+ are data. */
  data: string[][]
  /** 2D array matching data dimensions; each entry styles one cell. */
  cellStyle?: (TableCellStyle | null)[][]
  /** Table-level border configuration. */
  borderStyle?: TableBorderStyle
}

export interface LayoutElement {
  id: string
  type: ElementType
  x: number
  y: number
  width: number
  height: number
  /** Data-driven visibility, colors, sizing, table rules (see `layout-behaviour.v1.json`). */
  behaviour?: ElementBehaviour
  style?: ElementStyle
  content?: string
  src?: string
  columns?: TableColumn[]
  /** Relative widths; PDF and canvas grid use as fractions. */
  columnWidths?: number[]
  /**
   * TABLE canvas: relative heights for preview *body* rows only (`fr` among extra vertical space).
   * Length equals effective `tablePreviewBodyRows`. Legacy JSON may use length 1+body (first slot ignored).
   */
  tableRowWeights?: number[]
  dataKey?: string
  /** Row fill: keys "-1" (header), "0"… (data row index in JSON / preview). */
  tableRowBackgrounds?: Record<string, string>
  /** Column fill: keys "0"… (column index). */
  tableColumnBackgrounds?: Record<string, string>
  /** Per-cell fill: keys "row,col" e.g. "-1,0" (header col 0), "0,2" (data row 0, col 2). Highest priority. */
  tableCellBackgrounds?: Record<string, string>
  /** TABLE canvas: when true, column letters (A, B, …) stay visible; omitted/false = off by default, show on hover. */
  tableShowColumnLetters?: boolean
  /** TABLE canvas: when true, row gutter (1, 2, …) stays visible; omitted/false = off by default, show on hover. */
  tableShowRowNumbers?: boolean
  /** TABLE editor canvas: body preview row count (default 3). */
  tablePreviewBodyRows?: number
  /** TABLE: when true + loop enabled, cell/border styles come from the variable data rather than canvas maps. */
  tableStyleFromVariable?: boolean
  strokeWidth?: number
  marginTop?: number
  marginBottom?: number
  /** Element-anchored comments (V1: stored in layout JSON). */
  comments?: ElementComment[]
  /** When true, block move/resize and content edits on canvas until unlocked. */
  locked?: boolean
  /** Elements with the same id move together when any member is dragged (editor-only; optional in JSON). */
  groupId?: string
  /** MERGED_SHAPE: filled/stroked regions in coordinates relative to element x,y (top-left). */
  shapePolys?: ShapeMultiPolygon
  /** MERGED_SHAPE: original elements before merge, for unmerge support. */
  mergedFromElements?: LayoutElement[]
  /**
   * RING: inner ellipse size as a fraction of outer width/height (same center).
   * e.g. 0.5 → inner diameters are half of outer — fill/stroke applies to the band between.
   */
  ringInnerRatio?: number
  /**
   * HEADER / FOOTER only: child elements in band-local coordinates (top-left of the band is 0,0).
   * When present (non-empty), rendering and PDF use these instead of legacy `content` on the band.
   */
  bandElements?: LayoutElement[]
  /** HEADER / FOOTER only: layout guides in band-local pt (same structure as page guides). */
  bandGuides?: PageGuides
  /** LIST: marker style. Default 'disc'. */
  listStyle?: ListStyle
  /** LIST: tree-structured items. Each node has `text` + optional `children`. */
  listItems?: ListItemNode[]
  /** LIST: vertical gap between items in pt. Default 4. */
  listItemSpacing?: number
  /** LIST: width of the marker column in pt. Default 16. */
  listIndent?: number
  /** LIST: start index for numbered markers (number/alpha/roman). Default 1. */
  listStartNumber?: number
  /** LIST loop mode: key within each object that holds child items (default 'children'). */
  listChildrenKey?: string
  /** Linked text frame: ID of the continuation element on the next page. */
  linkedNextId?: string
  /** Linked text frame: ID of the preceding element on the previous page. */
  linkedPrevId?: string
}

/** Elements with rich `content` + `style` (inline edit on canvas like TEXT). */
export function isRichTextElement(el: LayoutElement): boolean {
  return el.type === 'TEXT' || el.type === 'HEADER' || el.type === 'FOOTER'
}

/** Per-side page margins in pt (PDF points). */
export interface PageMargins {
  top: number
  right: number
  bottom: number
  left: number
}

export interface PageSpec {
  size: string
  /** Portrait or landscape orientation. Default portrait. */
  orientation?: 'portrait' | 'landscape'
  /** Legacy single margin; used when loading old layouts without `margins`. */
  margin: number
  margins: PageMargins
}

export const PAGE_A4_PT = { width: 595, height: 842 } as const

/** All supported page size presets (portrait orientation, dimensions in pt). */
export const PAGE_SIZE_PRESETS: Record<string, { width: number; height: number; label: string }> = {
  A3:       { width: 842, height: 1191, label: 'A3 (297 × 420 mm)' },
  A4:       { width: 595, height: 842,  label: 'A4 (210 × 297 mm)' },
  A5:       { width: 420, height: 595,  label: 'A5 (148 × 210 mm)' },
  LETTER:   { width: 612, height: 792,  label: 'Letter (8.5 × 11 in)' },
  LEGAL:    { width: 612, height: 1008, label: 'Legal (8.5 × 14 in)' },
  TABLOID:  { width: 792, height: 1224, label: 'Tabloid (11 × 17 in)' },
  EXECUTIVE:{ width: 522, height: 756,  label: 'Executive (7.25 × 10.5 in)' },
  B4:       { width: 709, height: 1001, label: 'B4 (250 × 353 mm)' },
  B5:       { width: 499, height: 709,  label: 'B5 (176 × 250 mm)' },
} as const

/** Stable id for layouts that only had a single top-level `elements` array. */
export const LEGACY_SINGLE_PAGE_ID = 'page_1'

/** Catalog entry for preview / PDF data keys (optional description for authors). */
export interface VariableDefinition {
  key: string
  description?: string
}

/** User-placed layout guides (pt, page coordinates). Persisted per page in layout JSON. */
export type PageGuides = { vertical: number[]; horizontal: number[] }

export function emptyPageGuides(): PageGuides {
  return { vertical: [], horizontal: [] }
}

export interface LayoutJsonPage {
  id?: string
  name?: string
  elements?: Record<string, unknown>[]
  /** Variables intended for this page (keys should be unique vs global catalog). */
  localVariables?: VariableDefinition[]
  /** Optional Photoshop-style guides (pt). */
  guides?: { vertical?: number[]; horizontal?: number[] }
}

export interface LayoutJson {
  page: {
    size: string
    margin: number
    margins?: PageMargins
    orientation?: 'portrait' | 'landscape'
  }
  /** Optional template / layout DSL version for migrations. */
  layoutSchemaVersion?: number
  /** Template-wide variables (available on every page in behaviour + Variables tab). */
  globalVariables?: VariableDefinition[]
  /** Legacy: first canvas page only. Still written for older consumers. */
  elements?: Record<string, unknown>[]
  /** Multi-page document; preferred when present. */
  pages?: LayoutJsonPage[]
}

/** One document page in the editor (canvas layer stack). */
export interface LayoutDocumentPage {
  id: string
  name: string
  elements: LayoutElement[]
  localVariables?: VariableDefinition[]
  /** User-placed guides for this page (editor + optional PDF overlay later). */
  guides?: PageGuides
}

export function defaultPageSpec(): PageSpec {
  const m = 40
  return {
    size: 'A4',
    margin: m,
    margins: { top: m, right: m, bottom: m, left: m },
  }
}

export function normalizePageSpec(raw: unknown): PageSpec {
  const d = defaultPageSpec()
  if (!raw || typeof raw !== 'object') return d
  const o = raw as Record<string, unknown>
  const legacy = Number(o.margin)
  const margin = Number.isFinite(legacy) ? legacy : d.margin
  const mr = o.margins as Partial<PageMargins> | undefined
  const orientation =
    o.orientation === 'landscape' ? 'landscape' as const
    : o.orientation === 'portrait' ? 'portrait' as const
    : undefined
  return {
    size: String(o.size ?? d.size),
    orientation,
    margin,
    margins: {
      top: Number.isFinite(Number(mr?.top)) ? Number(mr?.top) : margin,
      right: Number.isFinite(Number(mr?.right)) ? Number(mr?.right) : margin,
      bottom: Number.isFinite(Number(mr?.bottom)) ? Number(mr?.bottom) : margin,
      left: Number.isFinite(Number(mr?.left)) ? Number(mr?.left) : margin,
    },
  }
}

export function pageDimensionsPt(spec: PageSpec): { width: number; height: number } {
  const s = String(spec.size ?? 'A4').toUpperCase()
  const preset = PAGE_SIZE_PRESETS[s] ?? PAGE_SIZE_PRESETS.A4
  const landscape = spec.orientation === 'landscape'
  return landscape
    ? { width: preset.height, height: preset.width }
    : { width: preset.width, height: preset.height }
}

const DEFAULT_GRID = 10

export function snap(n: number, gridSize: number = DEFAULT_GRID): number {
  return Math.round(n / gridSize) * gridSize
}

/** Safe numeric for layout / CSS: avoids NaN from bad JSON or `Number("…")`. */
export function coerceLayoutScalar(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export function newElementId(): string {
  return `el_${crypto.randomUUID().slice(0, 8)}`
}

export function newGroupId(): string {
  return `grp_${crypto.randomUUID().slice(0, 8)}`
}

export function newPageId(): string {
  return `pg_${crypto.randomUUID().slice(0, 8)}`
}

/** Relative column weights for TABLE layout (same length as columns). Defaults to equal widths. */
export function normalizeColumnWidths(columnCount: number, raw?: number[]): number[] {
  if (columnCount < 1) return []
  if (!raw?.length || raw.length !== columnCount) {
    return Array.from({ length: columnCount }, () => 1)
  }
  return raw.map((w) => {
    const n = Number(w)
    return Number.isFinite(n) && n > 0 ? Math.min(100, n) : 1
  })
}

/** TABLE preview *body* row weights (length `bodyRowCount`). Mismatched lengths reset to equal. */
export function normalizeRowWeights(bodyRowCount: number, raw?: number[]): number[] {
  if (bodyRowCount < 1) return []
  if (!raw?.length || raw.length !== bodyRowCount) {
    return Array.from({ length: bodyRowCount }, () => 1)
  }
  return raw.map((w) => {
    const n = Number(w)
    return Number.isFinite(n) && n > 0 ? Math.min(100, n) : 1
  })
}

export function elementToJson(el: LayoutElement): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
  }
  if (el.style && Object.keys(el.style).length > 0) {
    // Serialize style — gradient objects are stored as-is (JSON-safe plain objects)
    base.style = el.style
  }
  if (el.content != null) base.content = el.content
  if (el.src != null) base.src = el.src
  if (el.columns?.length) base.columns = el.columns
  if (
    el.columnWidths?.length &&
    el.columns?.length &&
    el.columnWidths.length === el.columns.length
  ) {
    base.columnWidths = el.columnWidths
  }
  if (el.type === 'TABLE') {
    const pr =
      el.tablePreviewBodyRows != null && Number.isFinite(el.tablePreviewBodyRows)
        ? Math.max(1, Math.min(30, Math.floor(el.tablePreviewBodyRows)))
        : 3
    const tw = el.tableRowWeights
    if (tw?.length === pr) {
      base.tableRowWeights = tw
    }
  }
  if (el.dataKey != null) base.dataKey = el.dataKey
  if (el.tableRowBackgrounds && Object.keys(el.tableRowBackgrounds).length > 0) {
    base.tableRowBackgrounds = el.tableRowBackgrounds
  }
  if (el.tableColumnBackgrounds && Object.keys(el.tableColumnBackgrounds).length > 0) {
    base.tableColumnBackgrounds = el.tableColumnBackgrounds
  }
  if (el.tableCellBackgrounds && Object.keys(el.tableCellBackgrounds).length > 0) {
    base.tableCellBackgrounds = el.tableCellBackgrounds
  }
  if (el.tableShowColumnLetters === true) base.tableShowColumnLetters = true
  if (el.tableShowRowNumbers === true) base.tableShowRowNumbers = true
  if (
    el.type === 'TABLE' &&
    el.tablePreviewBodyRows != null &&
    Number.isFinite(el.tablePreviewBodyRows) &&
    el.tablePreviewBodyRows !== 3
  ) {
    base.tablePreviewBodyRows = el.tablePreviewBodyRows
  }
  if (el.tableStyleFromVariable === true) base.tableStyleFromVariable = true
  if (el.comments?.length) base.comments = el.comments
  if (el.strokeWidth != null) base.strokeWidth = el.strokeWidth
  if (el.marginTop != null) base.marginTop = el.marginTop
  if (el.marginBottom != null) base.marginBottom = el.marginBottom
  if (el.locked) base.locked = true
  if (el.groupId?.trim()) base.groupId = el.groupId
  if (el.shapePolys != null && el.shapePolys.length > 0) base.shapePolys = el.shapePolys
  if (el.mergedFromElements && el.mergedFromElements.length > 0) {
    base.mergedFromElements = el.mergedFromElements.map(elementToJson)
  }
  if (el.ringInnerRatio != null && Number.isFinite(el.ringInnerRatio)) base.ringInnerRatio = el.ringInnerRatio
  if (el.behaviour && Object.keys(el.behaviour).length > 0) base.behaviour = el.behaviour
  if (el.bandElements && el.bandElements.length > 0) {
    base.bandElements = el.bandElements.map(elementToJson)
  }
  if (el.bandGuides && (el.bandGuides.vertical.length > 0 || el.bandGuides.horizontal.length > 0)) {
    base.bandGuides = { vertical: [...el.bandGuides.vertical], horizontal: [...el.bandGuides.horizontal] }
  }
  // LIST fields
  if (el.listStyle && el.listStyle !== 'disc') base.listStyle = el.listStyle
  if (el.listItems?.length) base.listItems = el.listItems
  if (el.listItemSpacing != null && el.listItemSpacing !== 4) base.listItemSpacing = el.listItemSpacing
  if (el.listIndent != null && el.listIndent !== 16) base.listIndent = el.listIndent
  if (el.listStartNumber != null && el.listStartNumber !== 1) base.listStartNumber = el.listStartNumber
  if (el.listChildrenKey?.trim() && el.listChildrenKey !== 'children') base.listChildrenKey = el.listChildrenKey
  // Linked text frame fields
  if (el.linkedNextId?.trim()) base.linkedNextId = el.linkedNextId
  if (el.linkedPrevId?.trim()) base.linkedPrevId = el.linkedPrevId
  return base
}

function parseCssColorRecord(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function parseGradientDef(raw: unknown): GradientDef | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const type = o.type
  if (type !== 'linear' && type !== 'radial') return undefined
  const stops = o.stops
  if (!Array.isArray(stops) || stops.length < 2) return undefined
  const parsed: GradientStop[] = []
  for (const s of stops) {
    if (!s || typeof s !== 'object') continue
    const so = s as Record<string, unknown>
    const color = typeof so.color === 'string' ? so.color : undefined
    const pos = Number(so.position)
    if (!color || !Number.isFinite(pos)) continue
    parsed.push({ color, position: Math.max(0, Math.min(1, pos)) })
  }
  if (parsed.length < 2) return undefined
  const angle = Number(o.angle)
  return { type, angle: Number.isFinite(angle) ? angle : undefined, stops: parsed }
}

function sanitizeElementStyle(raw: unknown): ElementStyle | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const s = { ...(raw as ElementStyle) }
  // Parse gradient sub-objects through validation
  if (s.colorGradient) s.colorGradient = parseGradientDef(s.colorGradient) ?? undefined
  if (s.bgGradient) s.bgGradient = parseGradientDef(s.bgGradient) ?? undefined
  return Object.keys(s).length > 0 ? s : undefined
}

export function jsonToElement(raw: Record<string, unknown>): LayoutElement {
  const style = sanitizeElementStyle(raw.style)
  let type = String(raw.type ?? 'TEXT').toUpperCase()
  if (type === 'PARAGRAPH') type = 'TEXT'
  return {
    id: String(raw.id ?? newElementId()),
    type: (type as ElementType) || 'TEXT',
    x: coerceLayoutScalar(raw.x, 0),
    y: coerceLayoutScalar(raw.y, 0),
    width: coerceLayoutScalar(raw.width, 120),
    height: coerceLayoutScalar(raw.height, 24),
    style,
    content: raw.content != null ? String(raw.content) : undefined,
    src: raw.src != null ? String(raw.src) : undefined,
    columns: Array.isArray(raw.columns) ? (raw.columns as TableColumn[]) : undefined,
    columnWidths: (() => {
      const cols = Array.isArray(raw.columns) ? raw.columns.length : 0
      if (!cols || !Array.isArray(raw.columnWidths)) return undefined
      const arr = (raw.columnWidths as unknown[]).map((x) => Number(x))
      if (arr.length !== cols || arr.some((n) => !Number.isFinite(n) || n <= 0)) return undefined
      return arr
    })(),
    tableRowWeights: (() => {
      if (!Array.isArray(raw.tableRowWeights)) return undefined
      const arr = (raw.tableRowWeights as unknown[]).map((x) => Number(x))
      if (arr.length < 1 || arr.some((n) => !Number.isFinite(n) || n <= 0)) return undefined
      return arr
    })(),
    dataKey: raw.dataKey != null ? String(raw.dataKey) : undefined,
    tableRowBackgrounds: parseCssColorRecord(raw.tableRowBackgrounds),
    tableColumnBackgrounds: parseCssColorRecord(raw.tableColumnBackgrounds),
    tableCellBackgrounds: parseCssColorRecord(raw.tableCellBackgrounds),
    tableShowColumnLetters: raw.tableShowColumnLetters === true ? true : undefined,
    tableShowRowNumbers: raw.tableShowRowNumbers === true ? true : undefined,
    tablePreviewBodyRows: (() => {
      const v = raw.tablePreviewBodyRows
      if (v == null) return undefined
      const n = Number(v)
      if (!Number.isFinite(n)) return undefined
      return Math.max(1, Math.min(30, Math.floor(n)))
    })(),
    tableStyleFromVariable: raw.tableStyleFromVariable === true ? true : undefined,
    comments: Array.isArray(raw.comments) && raw.comments.length > 0
      ? (raw.comments as ElementComment[])
      : undefined,
    strokeWidth: raw.strokeWidth != null ? Number(raw.strokeWidth) : undefined,
    marginTop: raw.marginTop != null ? Number(raw.marginTop) : undefined,
    marginBottom: raw.marginBottom != null ? Number(raw.marginBottom) : undefined,
    locked: raw.locked === true,
    groupId:
      raw.groupId != null && String(raw.groupId).trim() ? String(raw.groupId) : undefined,
    shapePolys: parseShapeMultiPolygon(raw.shapePolys),
    mergedFromElements: (() => {
      const arr = raw.mergedFromElements
      if (!Array.isArray(arr) || arr.length === 0) return undefined
      return arr.map((x) => jsonToElement(x as Record<string, unknown>))
    })(),
    ringInnerRatio:
      raw.ringInnerRatio != null && Number.isFinite(Number(raw.ringInnerRatio))
        ? Number(raw.ringInnerRatio)
        : undefined,
    behaviour: parseElementBehaviour(raw.behaviour),
    bandElements: (() => {
      const arr = raw.bandElements
      if (!Array.isArray(arr) || arr.length === 0) return undefined
      return arr.map((x) => jsonToElement(x as Record<string, unknown>))
    })(),
    bandGuides: (() => {
      const g = raw.bandGuides
      if (!g || typeof g !== 'object') return undefined
      const o = g as Record<string, unknown>
      const v = Array.isArray(o.vertical) ? o.vertical.map((n) => Number(n)).filter(Number.isFinite) : []
      const h = Array.isArray(o.horizontal) ? o.horizontal.map((n) => Number(n)).filter(Number.isFinite) : []
      if (!v.length && !h.length) return undefined
      return { vertical: v, horizontal: h }
    })(),
    // LIST fields
    listStyle: (() => {
      const v = raw.listStyle
      if (typeof v !== 'string') return undefined
      const valid: ListStyle[] = ['disc', 'circle', 'square', 'dash', 'number', 'alpha', 'roman', 'none']
      return valid.includes(v as ListStyle) ? (v as ListStyle) : undefined
    })(),
    listItems: (() => {
      if (!Array.isArray(raw.listItems)) return undefined
      const arr = raw.listItems as unknown[]
      if (arr.length === 0) return undefined
      // New tree format: array of { text, children? }
      if (typeof arr[0] === 'object' && arr[0] !== null && 'text' in (arr[0] as Record<string, unknown>)) {
        return parseListItemNodes(arr)
      }
      // Legacy flat format: string[] + optional listItemIndents[]
      const texts = arr.filter((x): x is string => typeof x === 'string')
      if (texts.length === 0) return undefined
      const indents: number[] = Array.isArray(raw.listItemIndents)
        ? (raw.listItemIndents as unknown[]).map((x) => {
            const n = Number(x)
            return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
          })
        : texts.map(() => 0)
      return buildListTree(texts, indents)
    })(),
    listItemSpacing: (() => {
      if (raw.listItemSpacing == null) return undefined
      const n = Number(raw.listItemSpacing)
      return Number.isFinite(n) && n >= 0 ? n : undefined
    })(),
    listIndent: (() => {
      if (raw.listIndent == null) return undefined
      const n = Number(raw.listIndent)
      return Number.isFinite(n) && n >= 0 ? n : undefined
    })(),
    listStartNumber: (() => {
      if (raw.listStartNumber == null) return undefined
      const n = Number(raw.listStartNumber)
      return Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : undefined
    })(),
    listChildrenKey: (() => {
      if (typeof raw.listChildrenKey !== 'string') return undefined
      const v = raw.listChildrenKey.trim()
      return v && v !== 'children' ? v : undefined
    })(),
    // Linked text frame fields
    linkedNextId: typeof raw.linkedNextId === 'string' && raw.linkedNextId.trim() ? raw.linkedNextId : undefined,
    linkedPrevId: typeof raw.linkedPrevId === 'string' && raw.linkedPrevId.trim() ? raw.linkedPrevId : undefined,
  }
}

// ── List tree helpers ──

/** Parse raw JSON into validated ListItemNode[]. */
function parseListItemNodes(arr: unknown[]): ListItemNode[] | undefined {
  const result: ListItemNode[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const text = typeof obj.text === 'string' ? obj.text : ''
    const node: ListItemNode = { text }
    if (Array.isArray(obj.children) && obj.children.length > 0) {
      const parsed = parseListItemNodes(obj.children)
      if (parsed?.length) node.children = parsed
    }
    result.push(node)
  }
  return result.length > 0 ? result : undefined
}

/** Convert legacy flat string[] + number[] into a ListItemNode tree. */
export function buildListTree(texts: string[], indents: number[]): ListItemNode[] {
  const root: ListItemNode[] = []
  const stack: [ListItemNode[], number][] = [[root, -1]]
  for (let i = 0; i < texts.length; i++) {
    const indent = indents[i] ?? 0
    const node: ListItemNode = { text: texts[i] }
    // Pop stack until we find the correct parent depth
    while (stack.length > 1 && stack[stack.length - 1][1] >= indent) stack.pop()
    stack[stack.length - 1][0].push(node)
    // This node's children array becomes the next potential parent
    const children: ListItemNode[] = []
    node.children = children
    stack.push([children, indent])
  }
  // Clean up empty children arrays
  const clean = (nodes: ListItemNode[]) => {
    for (const n of nodes) {
      if (n.children && n.children.length === 0) delete n.children
      else if (n.children) clean(n.children)
    }
  }
  clean(root)
  return root
}

/** Flatten a ListItemNode tree into parallel text[] + indent[] arrays. */
export function flattenListTree(nodes: ListItemNode[]): { texts: string[]; indents: number[] } {
  const texts: string[] = []
  const indents: number[] = []
  const walk = (arr: ListItemNode[], depth: number) => {
    for (const node of arr) {
      texts.push(node.text)
      indents.push(depth)
      if (node.children?.length) walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return { texts, indents }
}

function parseShapeMultiPolygon(raw: unknown): ShapeMultiPolygon | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  try {
    const multi: ShapeMultiPolygon = []
    for (const poly of raw) {
      if (!Array.isArray(poly) || poly.length === 0) continue
      const rings: ShapePolygon = []
      for (const ring of poly) {
        if (!Array.isArray(ring) || ring.length < 3) continue
        const pts: ShapeRing = []
        for (const p of ring) {
          if (!Array.isArray(p) || p.length < 2) continue
          const x = Number(p[0])
          const y = Number(p[1])
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue
          pts.push([x, y])
        }
        if (pts.length >= 3) rings.push(pts)
      }
      if (rings.length > 0) multi.push(rings)
    }
    return multi.length > 0 ? multi : undefined
  } catch {
    return undefined
  }
}

/** Normalizes author-entered variable names for catalog keys (global / local). */
export function normalizeCatalogVariableKey(raw: string): string {
  const t = raw.trim().replace(/\s+/g, '_').replace(/[^\w.]/g, '')
  if (!t) return ''
  return /^[0-9]/.test(t) ? `_${t}` : t
}

export function parseVariableDefinitionList(raw: unknown): VariableDefinition[] {
  if (!Array.isArray(raw)) return []
  const out: VariableDefinition[] = []
  const seenKeys = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const key = normalizeCatalogVariableKey(o.key != null ? String(o.key) : '')
    if (!key) continue
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    const description =
      typeof o.description === 'string' && o.description.trim() ? o.description.trim() : undefined
    out.push({ key, description })
  }
  return out
}

function parsePageGuides(raw: unknown): PageGuides | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const v = o.vertical
  const h = o.horizontal
  const vertical = Array.isArray(v)
    ? v.map((n) => Number(n)).filter((n) => Number.isFinite(n))
    : []
  const horizontal = Array.isArray(h)
    ? h.map((n) => Number(n)).filter((n) => Number.isFinite(n))
    : []
  if (!vertical.length && !horizontal.length) return undefined
  return { vertical, horizontal }
}

export function buildLayoutJson(
  pages: LayoutDocumentPage[],
  page: PageSpec,
  globalVariables?: VariableDefinition[]
): LayoutJson {
  const globals = filterPersistableVariableDefinitions(parseVariableDefinitionList(globalVariables ?? []))
  const serialized = pages.map((p) => {
    const locals = filterPersistableVariableDefinitions(parseVariableDefinitionList(p.localVariables ?? []))
    const g = p.guides
    const hasGuides =
      g && ((g.vertical?.length ?? 0) > 0 || (g.horizontal?.length ?? 0) > 0) ? g : null
    return {
      id: p.id,
      name: p.name,
      elements: p.elements.map(elementToJson),
      ...(locals.length ? { localVariables: locals } : {}),
      ...(hasGuides ? { guides: { vertical: hasGuides.vertical, horizontal: hasGuides.horizontal } } : {}),
    }
  })
  const firstElements = pages[0]?.elements.map(elementToJson) ?? []
  return {
    page: {
      size: page.size,
      margin: page.margin,
      margins: page.margins,
      ...(page.orientation ? { orientation: page.orientation } : {}),
    },
    layoutSchemaVersion: 2,
    ...(globals.length ? { globalVariables: globals } : {}),
    elements: firstElements,
    pages: serialized,
  }
}

export type ParsedLayoutResult = {
  pages: LayoutDocumentPage[]
  page: PageSpec
  globalVariables: VariableDefinition[]
}

export function parseLayoutJson(layout: LayoutJson | Record<string, unknown>): ParsedLayoutResult {
  const root = layout as Record<string, unknown>
  const pageRaw = root.page as Record<string, unknown> | undefined
  const page = normalizePageSpec(pageRaw)
  const globalVariables = filterPersistableVariableDefinitions(parseVariableDefinitionList(root.globalVariables))

  const pagesRaw = root.pages
  if (Array.isArray(pagesRaw) && pagesRaw.length > 0) {
    const pages: LayoutDocumentPage[] = pagesRaw.map((pr, i) => {
      const r = pr as LayoutJsonPage
      const id = typeof r.id === 'string' && r.id ? r.id : newPageId()
      const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : `Page ${i + 1}`
      const rawEls = r.elements
      const elements = Array.isArray(rawEls)
        ? rawEls.map((e) => jsonToElement(e as Record<string, unknown>))
        : []
      const localVariables = filterPersistableVariableDefinitions(parseVariableDefinitionList(r.localVariables))
      const guides = parsePageGuides((r as LayoutJsonPage & { guides?: unknown }).guides)
      return {
        id,
        name,
        elements,
        localVariables: localVariables.length ? localVariables : undefined,
        ...(guides ? { guides } : {}),
      }
    })
    return { pages, page, globalVariables }
  }

  const els = (layout as LayoutJson).elements
  const elements = Array.isArray(els)
    ? els.map((e) => jsonToElement(e as Record<string, unknown>))
    : []
  return {
    pages: [{ id: LEGACY_SINGLE_PAGE_ID, name: 'Page 1', elements }],
    page,
    globalVariables,
  }
}
