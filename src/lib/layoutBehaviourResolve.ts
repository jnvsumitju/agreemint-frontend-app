import {
  isSystemGlobalVariableKey,
  systemGlobalVariableDefinitions,
} from './systemTemplateVariables'
import type { ElementStyle, LayoutElement, LayoutDocumentPage, VariableDefinition } from '../types/layout'
import { normalizeCatalogVariableKey } from '../types/layout'
import { extractVariableKeys } from './variables'
import type { BehaviourCondition, ElementBehaviour } from '../types/layoutBehaviour'
import { substituteWithPipes } from './variablePipes'
import { applyRuleSets, evaluateRules, legacyToRules } from './unifiedRules'

export type ResolveWarning = { code: string; message: string }

function setDeep(obj: Record<string, unknown>, parts: string[], value: unknown) {
  let cur: Record<string, unknown> = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]
    const next = cur[p]
    if (next == null || typeof next !== 'object' || Array.isArray(next)) {
      cur[p] = {}
    }
    cur = cur[p] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]] = value
}

/** Turn flat Variables tab strings into nested objects + JSON-parse arrays/objects. */
export function variableValuesToDataTree(values: Record<string, string>): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(values)) {
    const t = raw.trim()
    let val: unknown = raw
    if (
      (t.startsWith('[') && t.endsWith(']')) ||
      (t.startsWith('{') && t.endsWith('}'))
    ) {
      try {
        val = JSON.parse(t) as unknown
      } catch {
        val = raw
      }
    }
    if (key.includes('.')) {
      setDeep(root, key.split('.'), val)
    } else {
      root[key] = val
    }
  }
  return root
}

function resolvePath(root: Record<string, unknown> | null | undefined, path: string): unknown {
  if (!root || !path) return undefined
  const parts = path.split('.')
  let cur: unknown = root
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

/**
 * Resolve a dotted variable path against the current data scope, falling
 * back to row-local data. Exported so the unified-rules evaluator can
 * share the same substitution semantics as the legacy resolvers.
 */
export function lookup(path: string, globalData: Record<string, unknown>, row: Record<string, unknown> | null): unknown {
  let n = resolvePath(globalData, path)
  if (n === undefined && row) {
    n = resolvePath(row, path)
  }
  return n
}

export function substituteTemplate(
  template: string,
  globalData: Record<string, unknown>,
  row: Record<string, unknown> | null
): string {
  if (!template) return ''
  return substituteWithPipes(template, (key) => lookup(key, globalData, row))
}

/** Shared number coercion — exported for the unified-rules evaluator. */
export function coerceNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function operandValue(
  raw: string | number | boolean,
  globalData: Record<string, unknown>,
  row: Record<string, unknown> | null
): unknown {
  if (typeof raw !== 'string') return raw
  const t = raw.trim()
  const m = /^\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}$/.exec(t)
  if (m) {
    return lookup(m[1], globalData, row)
  }
  return substituteTemplate(raw, globalData, row)
}

/**
 * True once the user has filled in enough of the condition for it to be
 * meaningfully evaluated. Previously a rule with no left/right (i.e. the user
 * just clicked "Add rule" and didn't configure it) would evaluate as
 * {@code String(undefined) === String(undefined)} → true and silently apply
 * itself to every element — the "empty color rule still fires" UX bug.
 */
function isConditionConfigured(c: BehaviourCondition | undefined | null): boolean {
  if (!c) return false
  const left = c.left
  if (left === undefined || left === null || (typeof left === 'string' && left.trim() === '')) {
    return false
  }
  // "defined" needs only a left-hand side; everything else needs a right too.
  if (c.op === 'defined') return true
  const right = c.right
  if (right === undefined || right === null || (typeof right === 'string' && right.trim() === '')) {
    return false
  }
  return true
}

/**
 * Evaluate a single flat comparison. Exported for the unified-rules
 * {@link evaluateRules} function, which decomposes its AND/OR condition
 * tree down to comparisons and delegates each leaf to this.
 */
export function evalCondition(
  c: BehaviourCondition,
  globalData: Record<string, unknown>,
  row: Record<string, unknown> | null
): boolean {
  if (!isConditionConfigured(c)) return false
  const leftRaw = operandValue(c.left, globalData, row)
  const op = c.op

  if (op === 'defined') {
    return leftRaw !== undefined && leftRaw !== null && leftRaw !== ''
  }

  const rightRaw = c.right !== undefined ? operandValue(c.right, globalData, row) : undefined

  switch (op) {
    case 'eq':
      return String(leftRaw) === String(rightRaw)
    case 'neq':
      return String(leftRaw) !== String(rightRaw)
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const ln = coerceNumber(leftRaw)
      const rn = coerceNumber(rightRaw)
      if (ln == null || rn == null) return false
      if (op === 'gt') return ln > rn
      if (op === 'gte') return ln >= rn
      if (op === 'lt') return ln < rn
      return ln <= rn
    }
    case 'in': {
      const s = String(rightRaw ?? '')
      const parts = s.split(',').map((x) => x.trim())
      return parts.includes(String(leftRaw))
    }
    default:
      return false
  }
}

/** Number clamp — exported for the unified-rules evaluator. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** After `{{}}` substitution, evaluate numeric expr: + - * / ( ) min max clamp */
export function evalSizeExpression(expr: string, fallback: number): number {
  const s = expr.replace(/\s+/g, '')
  if (!s) return fallback
  let i = 0

  const peek = () => s[i]
  const eat = (c: string) => {
    if (peek() === c) {
      i++
      return true
    }
    return false
  }

  function parseNumber(): number {
    if (s.slice(i, i + 4) === 'min(') {
      i += 4
      const a = parseExpr()
      eat(',')
      const b = parseExpr()
      eat(')')
      return Math.min(a, b)
    }
    if (s.slice(i, i + 4) === 'max(') {
      i += 4
      const a = parseExpr()
      eat(',')
      const b = parseExpr()
      eat(')')
      return Math.max(a, b)
    }
    if (s.slice(i, i + 6) === 'clamp(') {
      i += 6
      const x = parseExpr()
      eat(',')
      const lo = parseExpr()
      eat(',')
      const hi = parseExpr()
      eat(')')
      return clamp(x, lo, hi)
    }
    let start = i
    if (peek() === '-') {
      i++
    }
    while (i < s.length && /[0-9.]/.test(peek()!)) i++
    const chunk = s.slice(start, i)
    const n = Number(chunk)
    return Number.isFinite(n) ? n : fallback
  }

  function parseFactor(): number {
    if (eat('(')) {
      const v = parseExpr()
      eat(')')
      return v
    }
    return parseNumber()
  }

  function parseTerm(): number {
    let v = parseFactor()
    while (peek() === '*' || peek() === '/') {
      const op = peek()!
      i++
      const r = parseFactor()
      v = op === '*' ? v * r : r === 0 ? v : v / r
    }
    return v
  }

  function parseExpr(): number {
    let v = parseTerm()
    while (peek() === '+' || peek() === '-') {
      const op = peek()!
      i++
      const r = parseTerm()
      v = op === '+' ? v + r : v - r
    }
    return v
  }

  try {
    const v = parseExpr()
    return Number.isFinite(v) ? v : fallback
  } catch {
    return fallback
  }
}

// The legacy `resolveVisibility` / `resolveColors` / `resolveSize` /
// `applyImageSrc` direct-on-behaviour helpers used to live here. They were
// retired when `resolveLayoutElement` rerouted through the unified
// {@link evaluateRules} pipeline — legacy templates now flow through the
// same path via `legacyToRules`, so there's a single source of truth.

function applyTextOverflow(el: LayoutElement, b: ElementBehaviour | undefined): LayoutElement {
  const mode = b?.textOverflow?.mode
  if (!mode || !isRichTextLike(el)) return el
  const minFs = b.textOverflow?.minFontSize ?? 8
  const baseFs = el.style?.fontSize ?? 12
  let style: ElementStyle = el.style ? { ...el.style } : {}
  if (mode === 'shrinkToFit') {
    const plain = (el.content ?? '').replace(/<[^>]+>/g, '')
    const ratio = plain.length > 0 ? Math.min(1, (el.width || 200) / (plain.length * (baseFs * 0.52))) : 1
    style = { ...style, fontSize: Math.max(minFs, Math.floor(baseFs * ratio)) }
  } else if (mode === 'ellipsis' && typeof el.content === 'string' && el.content.length > 0 && !el.content.trim().startsWith('{')) {
    const maxChars = Math.max(4, Math.floor((el.width || 200) / (baseFs * 0.45)))
    const t = el.content.trim()
    if (t.length > maxChars) {
      return { ...el, style, content: `${t.slice(0, maxChars - 1)}…` }
    }
  }
  return { ...el, style }
}

function isRichTextLike(el: LayoutElement): boolean {
  return el.type === 'TEXT' || el.type === 'HEADER' || el.type === 'FOOTER' || el.type === 'FLOATING'
}

export function resolveLayoutElement(
  el: LayoutElement,
  data: Record<string, unknown>,
  row: Record<string, unknown> | null
): { element: LayoutElement; visible: boolean; warnings: ResolveWarning[] } {
  const warnings: ResolveWarning[] = []
  const b = el.behaviour

  // New unified path: every rule (visibility / color / size / image / future
  // property bindings) goes through evaluateRules. Legacy templates are
  // converted on the fly via legacyToRules so they render identically
  // until the next save flips them to the new schema.
  const rules = b?.rules && b.rules.length > 0 ? b.rules : legacyToRules(b)
  const defaultShow = b?.visibilityDefaultShow !== false
  const { visible, sets } = evaluateRules(rules, defaultShow, data, row)

  if (!visible) {
    return { element: el, visible: false, warnings }
  }

  let next: LayoutElement = applyRuleSets(el, sets)

  // Text overflow is not yet a rule action — special flow, bespoke math.
  // Keep it as a post-step so a rule that sets `fontSize` still gets
  // clipped/ellipsed correctly.
  next = applyTextOverflow(next, b)

  contrastHint(next.style, warnings)

  return { element: next, visible: true, warnings }
}

function contrastHint(style: ElementStyle | undefined, warnings: ResolveWarning[]) {
  if (!style?.color || !style?.backgroundColor) return
  // lightweight luminance check (optional UX)
  const lr = parseRgb(style.color)
  const lb = parseRgb(style.backgroundColor)
  if (lr != null && lb != null) {
    const c = Math.abs(luminance(lr) - luminance(lb))
    if (c < 0.08) {
      warnings.push({
        code: 'low_contrast',
        message: 'Text/foreground and background may have low contrast in PDF output.',
      })
    }
  }
}

function parseRgb(css: string): [number, number, number] | null {
  const m = css.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const h = m[1]
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ]
  }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function luminance([r, g, b]: [number, number, number]): number {
  const srgb = [r, g, b].map((x) => {
    const v = x / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]
}

/** Table: should this data row be hidden given element behaviour? */
export function tableRowHidden(
  behaviour: ElementBehaviour | undefined,
  row: Record<string, unknown>,
  data: Record<string, unknown>
): boolean {
  const rules = behaviour?.table?.rowRules
  if (!rules?.length) return false
  for (const r of rules) {
    if (r.hide && evalCondition(r.when, data, row)) return true
  }
  return false
}

/** Resolved cell text/background for PDF/canvas (column index). */
export function tableCellBehaviourStyle(
  behaviour: ElementBehaviour | undefined,
  row: Record<string, unknown>,
  data: Record<string, unknown>,
  colIndex: number,
  baseTextColor?: string,
  baseBg?: string
): { textColor?: string; backgroundColor?: string } {
  const rules = behaviour?.table?.cellRules
  if (!rules?.length) return {}
  for (const r of rules) {
    if (r.colIndex !== colIndex) continue
    if (!evalCondition(r.when, data, row)) continue
    return {
      textColor: r.textColor ?? baseTextColor,
      backgroundColor: r.backgroundColor ?? baseBg,
    }
  }
  return {}
}

/** Keys authors may reference in behaviour rules for the current page (catalog + template usage on that page). */
export function availableVariableKeysForBehaviour(
  globalDefs: VariableDefinition[],
  activePage: LayoutDocumentPage | undefined,
  activePageElements: LayoutElement[]
): string[] {
  const set = new Set<string>()
  for (const d of systemGlobalVariableDefinitions()) {
    const k = normalizeCatalogVariableKey(d.key ?? '')
    if (k) set.add(k)
  }
  for (const d of globalDefs) {
    const k = normalizeCatalogVariableKey(d.key ?? '')
    if (k) set.add(k)
  }
  for (const d of activePage?.localVariables ?? []) {
    const k = normalizeCatalogVariableKey(d.key ?? '')
    if (k) set.add(k)
  }
  for (const k of extractVariableKeys(activePageElements)) set.add(k)
  return [...set].sort()
}

/**
 * Flat `variableValues` / merge-field key when a page-local catalog field shadows a global name.
 * Uses `_page` (not `page`) so a legitimate variable named `page` does not collide with nesting.
 */
export const PAGE_LOCAL_SHADOW_PREFIX = '_page'

export function pageLocalShadowStorageKey(catalogNormKey: string): string {
  return `${PAGE_LOCAL_SHADOW_PREFIX}.${catalogNormKey}`
}

function catalogHasNormalizedKey(defs: VariableDefinition[], normKey: string): boolean {
  return defs.some((d) => normalizeCatalogVariableKey(d.key ?? '') === normKey)
}

/** True when the same normalized key exists in template globals and on the given page's locals. */
export function globalAndPageLocalCatalogCollision(
  normKey: string,
  globalDefs: VariableDefinition[],
  page: LayoutDocumentPage | undefined
): boolean {
  return catalogHasNormalizedKey(globalDefs, normKey) && catalogHasNormalizedKey(page?.localVariables ?? [], normKey)
}

/**
 * Extra `variableValues` keys so page-local previews do not overwrite globals when names collide.
 * One entry per shadowed key per page that declares a local with that name.
 */
export function shadowStorageKeysForCatalogCollisions(
  globalDefs: VariableDefinition[],
  pages: LayoutDocumentPage[]
): string[] {
  const globals = new Set<string>()
  for (const d of globalDefs) {
    const k = normalizeCatalogVariableKey(d.key ?? '')
    if (k) globals.add(k)
  }
  const out = new Set<string>()
  for (const p of pages) {
    for (const d of p.localVariables ?? []) {
      const k = normalizeCatalogVariableKey(d.key ?? '')
      if (k && globals.has(k)) out.add(pageLocalShadowStorageKey(k))
    }
  }
  return [...out]
}

export type VariableMentionItem = { id: string; label: string }

/**
 * @-mention list for rich text: each entry has a unique `id` (inserted token) and a disambiguating
 * `label`. When a global and the active page's local share a name, two rows appear: template-wide
 * `id === key` and page-local `id === _page.<key>` (see `pageLocalShadowStorageKey`).
 */
export function availableVariableMentionsForMentionSuggest(
  globalDefs: VariableDefinition[],
  pages: LayoutDocumentPage[],
  activePageIndex: number,
  variableValues: Record<string, string>
): VariableMentionItem[] {
  const activePage = pages[activePageIndex]
  const allEls = pages.flatMap((p) => p.elements)
  const set = new Set<string>()
  for (const d of systemGlobalVariableDefinitions()) {
    const k = normalizeCatalogVariableKey(d.key ?? '')
    if (k) set.add(k)
  }
  for (const d of globalDefs) {
    const k = normalizeCatalogVariableKey(d.key ?? '')
    if (k) set.add(k)
  }
  for (const d of activePage?.localVariables ?? []) {
    const k = normalizeCatalogVariableKey(d.key ?? '')
    if (k) set.add(k)
  }
  for (const k of extractVariableKeys(allEls)) set.add(k)
  for (const raw of Object.keys(variableValues ?? {})) {
    const k = normalizeCatalogVariableKey(raw)
    if (k) set.add(k)
  }

  const shadowPrefix = `${PAGE_LOCAL_SHADOW_PREFIX}.`
  const keys = [...set].sort()
  const items: VariableMentionItem[] = []
  for (const k of keys) {
    if (k.startsWith(shadowPrefix)) {
      const base = k.slice(shadowPrefix.length)
      if (globalAndPageLocalCatalogCollision(base, globalDefs, activePage)) continue
    }
    const g = catalogHasNormalizedKey(globalDefs, k)
    const l = catalogHasNormalizedKey(activePage?.localVariables ?? [], k)
    if (g && l) {
      items.push({ id: k, label: `${k} · template-wide` })
      items.push({
        id: pageLocalShadowStorageKey(k),
        label: `${k} · this page`,
      })
    } else if (l && !g) {
      items.push({ id: k, label: `${k} · this page` })
    } else {
      items.push({ id: k, label: k })
    }
  }
  return items
}

/** Rich-text variable chip popover (canvas / panel) — scope, catalog description, Variables-tab preview. */
export type VariableChipInfo = {
  token: string
  scopeLine: string
  description?: string
  previewLine?: string
}

/**
 * Humanize a flat merge-field key for chip labels (matches preview / Variables style).
 *
 * Walks each segment between `.` / `_` / `-` and splits on these boundaries:
 *   - camelCase  (`borrowerName`     → `Borrower Name`)
 *   - PascalCase (`BorrowerName`     → `Borrower Name`)
 *   - acronym→word (`HTTPRequest`    → `HTTP Request`)
 *   - letter↔digit (`address1`       → `Address 1`, `top10Items` → `Top 10 Items`)
 * If the segment has none of those (e.g. an AI-generated `borrowername`),
 * it falls back to the old "Title-case the whole thing" behaviour so the
 * chip still reads as a single word rather than a glued lowercase blob.
 */
export function humanizeMergeFieldKeyLabel(rawKey: string): string {
  const k = rawKey.trim()
  if (!k) return ''
  return k
    .split(/[._-]/)
    .filter(Boolean)
    .map((segment) => splitWordBoundaries(segment))
    .map((words) =>
      words
        .map((w) => (isAllUpper(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
        .join(' ')
    )
    .join(' ')
}

/** Split a single identifier segment into words on case / digit boundaries. */
function splitWordBoundaries(segment: string): string[] {
  if (!segment) return []
  // Insert a marker on each boundary, then split on it. Order matters:
  //   1. acronym→word: `HTTPRequest` becomes `HTTP|Request` (lookahead: cap+lower
  //      after a run of caps splits before the cap+lower pair).
  //   2. lower→Upper: `borrowerName` becomes `borrower|Name`.
  //   3. letter↔digit both directions: `address1` / `2items`.
  const SEP = ''
  const marked = segment
    .replace(/([A-Z]+)([A-Z][a-z])/g, `$1${SEP}$2`)
    .replace(/([a-z])([A-Z])/g, `$1${SEP}$2`)
    .replace(/([A-Za-z])(\d)/g, `$1${SEP}$2`)
    .replace(/(\d)([A-Za-z])/g, `$1${SEP}$2`)
  return marked.split(SEP).filter(Boolean)
}

function isAllUpper(s: string): boolean {
  return s.length > 1 && s === s.toUpperCase() && /[A-Z]/.test(s)
}

/**
 * Short label shown on variable chips: `Page.Customer Name` vs `Global.Customer Name`.
 * Plain token when global + page both declare the same key is treated as template-wide (Global).
 */
export function variableMergeFieldSurfaceLabel(
  rawName: string,
  globalDefs: VariableDefinition[],
  activePage: LayoutDocumentPage | undefined
): string {
  const name = (rawName ?? '').trim()
  if (!name) return '{{}}'

  const norm = (k: string) => normalizeCatalogVariableKey(k)
  const shadowPrefix = `${PAGE_LOCAL_SHADOW_PREFIX}.`
  const isShadow = name.startsWith(shadowPrefix)
  const baseForCatalog = isShadow ? name.slice(shadowPrefix.length) : name
  const nk = norm(baseForCatalog)

  if (nk && isSystemGlobalVariableKey(nk)) {
    const tail = humanizeMergeFieldKeyLabel(nk) || nk
    return `Global.${tail}`
  }

  const globalDef = nk ? globalDefs.find((d) => norm(d.key ?? '') === nk) : undefined
  const localDef = nk ? activePage?.localVariables?.find((d) => norm(d.key ?? '') === nk) : undefined

  const tail = humanizeMergeFieldKeyLabel(nk || baseForCatalog) || humanizeMergeFieldKeyLabel(name) || name

  if (isShadow) return `Page.${tail}`
  if (localDef && !globalDef) return `Page.${tail}`
  if (globalDef && !localDef) return `Global.${tail}`
  if (globalDef && localDef) return `Global.${tail}`
  return `{{${name}}}`
}

export function resolveVariableChipInfo(
  rawName: string,
  globalDefs: VariableDefinition[],
  activePage: LayoutDocumentPage | undefined,
  variableValues: Record<string, string>
): VariableChipInfo {
  const name = (rawName ?? '').trim()
  const token = name ? `{{${name}}}` : '{{}}'

  const norm = (k: string) => normalizeCatalogVariableKey(k)
  const shadowPrefix = `${PAGE_LOCAL_SHADOW_PREFIX}.`
  const isShadow = name.startsWith(shadowPrefix)
  const baseForCatalog = isShadow ? name.slice(shadowPrefix.length) : name
  const nk = norm(baseForCatalog)

  if (nk && isSystemGlobalVariableKey(nk)) {
    const sys = systemGlobalVariableDefinitions().find((d) => norm(d.key ?? '') === nk)
    const previewRaw = name ? variableValues[name] ?? '' : ''
    const clipped =
      previewRaw.length > 220 ? `${previewRaw.slice(0, 220)}…` : previewRaw
    return {
      token,
      scopeLine:
        'Built-in global — value is computed from the document (not stored in layout JSON and not editable in the Variables tab).',
      ...(sys?.description?.trim() ? { description: sys.description.trim() } : {}),
      ...(clipped.trim() ? { previewLine: `Current preview: ${clipped}` } : {}),
    }
  }

  const globalDef = nk ? globalDefs.find((d) => norm(d.key ?? '') === nk) : undefined
  const localDef = nk ? activePage?.localVariables?.find((d) => norm(d.key ?? '') === nk) : undefined

  let scopeLine: string
  if (isShadow) {
    scopeLine =
      'This page only — stored under _page.* so it does not overwrite the template-wide field with the same display name.'
  } else if (globalDef && localDef) {
    scopeLine =
      'Template-wide merge value by default; this page also declares the same key. Use the “this page” @ option if you need the page-local value instead.'
  } else if (globalDef) {
    scopeLine = 'Template-wide — available on every page.'
  } else if (localDef) {
    scopeLine = 'Declared on this page only — not listed in global variables.'
  } else {
    scopeLine =
      'Not in the Variables catalog — preview still uses a matching Variables tab key when present.'
  }

  const descriptionRaw = (() => {
    if (isShadow) return localDef?.description?.trim() || globalDef?.description?.trim()
    if (globalDef && localDef) {
      const g = globalDef.description?.trim()
      const l = localDef.description?.trim()
      if (g && l && g !== l) return `Global: ${g}\nPage: ${l}`
      return g || l
    }
    return globalDef?.description?.trim() || localDef?.description?.trim()
  })()

  const previewRaw = name ? variableValues[name] ?? '' : ''
  let previewLine: string | undefined
  if (previewRaw.trim()) {
    const clipped = previewRaw.length > 220 ? `${previewRaw.slice(0, 220)}…` : previewRaw
    previewLine = `Variables tab preview: ${clipped}`
  }

  return {
    token,
    scopeLine,
    ...(descriptionRaw ? { description: descriptionRaw } : {}),
    ...(previewLine ? { previewLine } : {}),
  }
}
