import type { LayoutElement } from '../types/layout'

const VAR_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g

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
  const re = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g
  const out: PlainSegment[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) {
      out.push({ type: 'text', value: s.slice(last, m.index) })
    }
    out.push({ type: 'var', name: m[1] })
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
    }
  | { type: 'var'; name: string }

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
  if (r.type === 'var') {
    return { type: 'var', name: r.name }
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
        return { type: 'var', name: normalizeVariableIdentifier(run.name) }
      }
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
      }
    }),
  }
  return JSON.stringify(doc)
}

export function extractVariableKeysFromRuns(runs: RichRun[]): string[] {
  const set = new Set<string>()
  for (const r of runs) {
    if (r.type === 'var') set.add(normalizeVariableIdentifier(r.name))
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
    if (el.bandElements?.length) {
      for (const c of el.bandElements) walk(c)
    }
  }
  for (const el of elements) walk(el)
  return [...set].sort()
}

/** Plain substitution for canvas preview (concatenated string). */
export function substituteRunsPlain(runs: RichRun[], values: Record<string, string>): string {
  return runs
    .map((r) => {
      if (r.type === 'var') {
        const k = normalizeVariableIdentifier(r.name)
        return values[k] ?? ''
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
      String(prev.highlightColor ?? '') === String(r.highlightColor ?? '')
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
      })
    }
  }
  if (out.length === 0) return [{ type: 'text', text: '' }]
  return out
}
