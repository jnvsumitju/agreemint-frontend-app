import type { ElementStyle, LayoutElement } from '../types/layout'
import { isRichTextElement } from '../types/layout'
import {
  type RichRun,
  type TextRunFormatKey,
  parseContentToRuns,
  serializeRunsToContent,
} from './richContent'

export function patchTextRunColor(
  el: LayoutElement,
  runIndex: number,
  key: 'color' | 'highlightColor',
  value: string | undefined,
  updateElement: (id: string, patch: Partial<LayoutElement>) => void
) {
  if (!isRichTextElement(el)) return
  const runs = parseContentToRuns(el.content)
  const r = runs[runIndex]
  if (!r || r.type !== 'text') return
  const next: Extract<RichRun, { type: 'text' }> = { ...r }
  const v = value?.trim()
  if (!v) {
    if (key === 'color') delete next.color
    else delete next.highlightColor
  } else {
    next[key] = v
  }
  runs[runIndex] = next
  updateElement(el.id, { content: serializeRunsToContent(runs) })
}

export function mergeElementStyle(
  base: ElementStyle | undefined,
  patch: Partial<ElementStyle>
): ElementStyle | undefined {
  const next: ElementStyle = { ...(base ?? {}), ...patch }
  if (next.color !== undefined && String(next.color).trim() === '') delete next.color
  if (next.backgroundColor !== undefined && String(next.backgroundColor).trim() === '')
    delete next.backgroundColor
  return Object.keys(next).length > 0 ? next : undefined
}

export function omitStyleKey(
  style: ElementStyle | undefined,
  key: 'color' | 'backgroundColor'
): ElementStyle | undefined {
  if (!style) return undefined
  const rest: ElementStyle = { ...style }
  delete rest[key]
  // Also clear the corresponding gradient when clearing a color
  if (key === 'color') delete rest.colorGradient
  if (key === 'backgroundColor') delete rest.bgGradient
  return Object.keys(rest).length > 0 ? rest : undefined
}

export function omitGradientKey(
  style: ElementStyle | undefined,
  key: 'colorGradient' | 'bgGradient'
): ElementStyle | undefined {
  if (!style) return undefined
  const rest: ElementStyle = { ...style }
  delete rest[key]
  return Object.keys(rest).length > 0 ? rest : undefined
}

export function patchTextRunFormat(
  el: LayoutElement,
  runIndex: number,
  key: TextRunFormatKey,
  updateElement: (id: string, patch: Partial<LayoutElement>) => void
) {
  if (!isRichTextElement(el)) return
  const runs = parseContentToRuns(el.content)
  const r = runs[runIndex]
  if (!r || r.type !== 'text') return
  const next = { ...r, type: 'text' as const }
  if (key === 'superscript') {
    next.superscript = !r.superscript
    if (next.superscript) next.subscript = false
  } else if (key === 'subscript') {
    next.subscript = !r.subscript
    if (next.subscript) next.superscript = false
  } else if (key === 'bold') {
    next.bold = !next.bold
  } else if (key === 'italic') {
    next.italic = !next.italic
  } else if (key === 'underline') {
    next.underline = !next.underline
  } else if (key === 'strikethrough') {
    next.strikethrough = !next.strikethrough
  }
  runs[runIndex] = next
  updateElement(el.id, { content: serializeRunsToContent(runs) })
}
