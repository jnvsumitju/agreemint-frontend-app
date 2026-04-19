import type { LayoutElement } from '../types/layout'
import { applyPipes, parseVariableExpression, stripPipesFromKey, VAR_PIPE_RE } from './variablePipes'

const VAR_RE = VAR_PIPE_RE

export function normalizeVariableIdentifier(raw: string): string {
  const t = raw.trim().replace(/\s+/g, '_').replace(/[^\w.]/g, '')
  if (!t) return 'field'
  return /^[0-9]/.test(t) ? `_${t}` : t
}

type PlainSegment =
  | { type: 'text'; value: string }
  | { type: 'var'; name: string }

function parsePlainTemplateToSegments(content: string): PlainSegment[] {
  const s = content ?? ''
  const re = new RegExp(VAR_PIPE_RE.source, 'g')
  const out: PlainSegment[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) {
      out.push({ type: 'text', value: s.slice(last, m.index) })
    }
    // Store the full expression (key + pipes) so substitution can apply pipes
    const fullExpr = m[1] + (m[2] || '')
    out.push({ type: 'var', name: fullExpr.trim() })
    last = re.lastIndex
  }
  if (last < s.length) {
    out.push({ type: 'text', value: s.slice(last) })
  }
  if (out.length === 0) {
    out.push({ type: 'text', value: '' })
  }
  return out
}

function segmentsToRuns(segments: PlainSegment[]): RichRun[] {
  return segments.map((seg) =>
    seg.type === 'var'
      ? { type: 'var', name: seg.name }
      : { type: 'text', text: seg.value }
  )
}

export type RichRun =
  | {
      type: 'text'
      text: string
      bold?: boolean
      italic?: boolean
      underline?: boolean
      strikethrough?: boolean
      superscript?: boolean
      subscript?: boolean
      /** CSS text color (e.g. #0f172a, rgb(...)). */
      color?: string
      /** CSS background behind text (highlight). */
      highlightColor?: string
      /**
       * Hyperlink target for this run. May contain `{{var}}` placeholders
       * that get resolved at preview / PDF render time. Always-HTTPS is a
       * good default — the link editor auto-prepends `https://` to bare
       * domains, and the render paths reject non-safe protocols.
       */
      linkHref?: string
    }
  | {
      type: 'var'
      name: string
      /** A variable chip can itself be a hyperlink (e.g. `{{ticketUrl}}` shown as "Open ticket"). */
      linkHref?: string
    }

/** Run-level keys toggled from the formatting toolbar (Properties mode). */
export type TextRunFormatKey =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'superscript'
  | 'subscript'

export interface RichContentDoc {
  rich: true
  runs: RichRun[]
}

function isRichDoc(o: unknown): o is RichContentDoc {
  return (
    typeof o === 'object' &&
    o !== null &&
    (o as RichContentDoc).rich === true &&
    Array.isArray((o as RichContentDoc).runs)
  )
}

function normalizeRun(r: RichRun): RichRun {
  const link = typeof r.linkHref === 'string' ? sanitizeLinkHref(r.linkHref) : undefined
  if (r.type === 'var') {
    return link ? { type: 'var', name: r.name, linkHref: link } : { type: 'var', name: r.name }
  }
  let sup = !!r.superscript
  let sub = !!r.subscript
  if (sup && sub) sub = false
  const color = typeof r.color === 'string' && r.color.trim() ? r.color.trim() : undefined
  const highlightColor =
    typeof r.highlightColor === 'string' && r.highlightColor.trim()
      ? r.highlightColor.trim()
      : undefined
  return {
    type: 'text',
    text: r.text ?? '',
    bold: !!r.bold,
    italic: !!r.italic,
    underline: !!r.underline,
    strikethrough: !!r.strikethrough,
    superscript: sup,
    subscript: sub,
    ...(color ? { color } : {}),
    ...(highlightColor ? { highlightColor } : {}),
    ...(link ? { linkHref: link } : {}),
  }
}

/**
 * Protocols that are safe to store as link targets. Everything else
 * (javascript:, data:, file:, vbscript:, …) is stripped at save time so a
 * malicious paste can't embed an XSS vector into a template.
 */
const SAFE_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'] as const

/**
 * Clean a link URL:
 *   • trim + drop control characters
 *   • reject > 2 KB so a runaway paste can't blow up our JSON payloads
 *   • require a safe protocol; relative URLs and bare domains pass through
 *     and the UI prepends `https://` before calling this function
 * Returns the cleaned URL, or undefined if it should be dropped entirely.
 */
export function sanitizeLinkHref(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined
  // Strip ASCII control chars and trim.
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]+/g, '').trim()
  if (!cleaned) return undefined
  if (cleaned.length > 2048) return undefined
  // Allow `{{var}}`-only URLs as-is — they resolve at render time and may
  // expand to any of the safe protocols.
  if (/^\{\{[^}]+\}\}$/.test(cleaned)) return cleaned
  try {
    const parsed = new URL(cleaned)
    const proto = parsed.protocol.toLowerCase()
    if (!(SAFE_LINK_PROTOCOLS as readonly string[]).includes(proto)) return undefined
    return parsed.toString()
  } catch {
    // Not a full URL (e.g. "example.com/foo") — treat as untrusted and reject.
    // The UI layer is responsible for prepending `https://` before calling this.
    return undefined
  }
}

/** Parse element content: rich JSON document or legacy plain string with variables. */
export function parseContentToRuns(content: string | undefined): RichRun[] {
  const s = content ?? ''
  const trimmed = s.trim()
  if (trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(s) as unknown
      if (isRichDoc(j)) {
        return j.runs.map((x) => normalizeRun(x as RichRun))
      }
    } catch {
      /* legacy */
    }
  }
  return segmentsToRuns(parsePlainTemplateToSegments(s))
}

/** True when there is no visible text and no variables (only empty text runs). */
export function isEffectivelyEmptyRichContent(serialized: string | undefined): boolean {
  if (!serialized || !serialized.trim()) return true
  const runs = parseContentToRuns(serialized)
  if (runs.length === 0) return true
  return runs.every((r) => (r.type === 'var' ? false : (r.text ?? '').trim() === ''))
}

/**
 * Canvas inline edits call `onChange` on every keystroke, so the store usually has the latest text.
 * On commit, `inlineTipTapEditor` / refs can still point at a stale instance whose PM doc never
 * received those transactions; prefer the store when the editor serializes to an empty doc.
 */
export function preferStoreRichContentIfEditorEmpty(
  fromEditor: string,
  storeContent: string | undefined
): string {
  if (!storeContent) return fromEditor
  if (isEffectivelyEmptyRichContent(fromEditor) && !isEffectivelyEmptyRichContent(storeContent)) {
    return storeContent
  }
  return fromEditor
}

/** Legacy plain template with {{var}} (for serializers that only support plain). */
export function runsToPlainTemplate(runs: RichRun[]): string {
  return runs
    .map((run) =>
      run.type === 'var'
        ? `{{${normalizeVariableIdentifier(run.name)}}}`
        : run.text
    )
    .join('')
}

/** Persist runs as JSON (rich text). */
export function serializeRunsToContent(runs: RichRun[]): string {
  const doc: RichContentDoc = {
    rich: true,
    runs: runs.map((run) => {
      if (run.type === 'var') {
        const link = run.linkHref ? sanitizeLinkHref(run.linkHref) : undefined
        return {
          type: 'var',
          name: normalizeVariableIdentifier(run.name),
          ...(link ? { linkHref: link } : {}),
        }
      }
      const link = run.linkHref ? sanitizeLinkHref(run.linkHref) : undefined
      return {
        type: 'text',
        text: run.text,
        ...(run.bold ? { bold: true } : {}),
        ...(run.italic ? { italic: true } : {}),
        ...(run.underline ? { underline: true } : {}),
        ...(run.strikethrough ? { strikethrough: true } : {}),
        ...(run.superscript ? { superscript: true } : {}),
        ...(run.subscript ? { subscript: true } : {}),
        ...(run.color?.trim() ? { color: run.color.trim() } : {}),
        ...(run.highlightColor?.trim() ? { highlightColor: run.highlightColor.trim() } : {}),
        ...(link ? { linkHref: link } : {}),
      }
    }),
  }
  return JSON.stringify(doc)
}

export function extractVariableKeysFromRuns(runs: RichRun[]): string[] {
  const set = new Set<string>()
  for (const r of runs) {
    if (r.type === 'var') set.add(normalizeVariableIdentifier(stripPipesFromKey(r.name)))
  }
  return [...set].sort()
}

export function extractVariableKeysFromAnyContent(content: string | undefined): string[] {
  return extractVariableKeysFromRuns(parseContentToRuns(content))
}

export function extractVariableKeysFromLayout(elements: LayoutElement[]): string[] {
  const set = new Set<string>()
  const walk = (el: LayoutElement) => {
    for (const k of extractVariableKeysFromAnyContent(el.content)) set.add(k)
    if (el.columns) {
      for (const c of el.columns) {
        for (const k of extractVariableKeysFromAnyContent(c.header)) set.add(k)
      }
    }
    if (el.listItems?.length) {
      const walkListNodes = (nodes: typeof el.listItems) => {
        if (!nodes) return
        for (const node of nodes) {
          for (const k of extractVariableKeysFromAnyContent(node.text)) set.add(k)
          if (node.children?.length) walkListNodes(node.children)
        }
      }
      walkListNodes(el.listItems)
    }
    if (el.bandElements?.length) {
      for (const c of el.bandElements) walk(c)
    }
  }
  for (const el of elements) walk(el)
  return [...set].sort()
}

/** Plain substitution for canvas preview (concatenated string). Applies pipes. */
export function substituteRunsPlain(runs: RichRun[], values: Record<string, string>): string {
  return runs
    .map((r) => {
      if (r.type === 'var') {
        const parsed = parseVariableExpression(r.name)
        const k = normalizeVariableIdentifier(parsed.key)
        const raw = values[k] ?? ''
        if (parsed.pipes.length === 0) return raw
        return applyPipes(raw, parsed.pipes)
      }
      return r.text
    })
    .join('')
}

export { VAR_RE }

export function mergeAdjacentTextRuns(runs: RichRun[]): RichRun[] {
  const out: RichRun[] = []
  for (const r of runs) {
    if (r.type === 'var') {
      out.push(r)
      continue
    }
    const prev = out[out.length - 1]
    if (
      prev &&
      prev.type === 'text' &&
      !!prev.bold === !!r.bold &&
      !!prev.italic === !!r.italic &&
      !!prev.underline === !!r.underline &&
      !!prev.strikethrough === !!r.strikethrough &&
      !!prev.superscript === !!r.superscript &&
      !!prev.subscript === !!r.subscript &&
      String(prev.color ?? '') === String(r.color ?? '') &&
      String(prev.highlightColor ?? '') === String(r.highlightColor ?? '') &&
      String(prev.linkHref ?? '') === String(r.linkHref ?? '')
    ) {
      prev.text += r.text
    } else {
      out.push({
        type: 'text',
        text: r.text,
        bold: r.bold,
        italic: r.italic,
        underline: r.underline,
        strikethrough: r.strikethrough,
        superscript: r.superscript,
        subscript: r.subscript,
        color: r.color,
        highlightColor: r.highlightColor,
        linkHref: r.linkHref,
      })
    }
  }
  if (out.length === 0) return [{ type: 'text', text: '' }]
  return out
}
