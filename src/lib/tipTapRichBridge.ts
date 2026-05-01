import type { Node as PMNode } from '@tiptap/pm/model'
import type { Mark } from '@tiptap/pm/model'
import type { JSONContent } from '@tiptap/core'
import type { RichRun } from './richContent'
import { mergeAdjacentTextRuns, normalizeVariableIdentifier, sanitizeLinkHref } from './richContent'

type TextRun = Extract<RichRun, { type: 'text' }>

function marksToTextPartial(marks: readonly Mark[]): Partial<Omit<TextRun, 'type' | 'text'>> {
  const o: Partial<Omit<TextRun, 'type' | 'text'>> = {}
  for (const m of marks) {
    switch (m.type.name) {
      case 'bold':
        o.bold = true
        break
      case 'italic':
        o.italic = true
        break
      case 'underline':
        o.underline = true
        break
      case 'strike':
        o.strikethrough = true
        break
      case 'superscript':
        o.superscript = true
        break
      case 'subscript':
        o.subscript = true
        break
      case 'textStyle':
        if (m.attrs.color) o.color = String(m.attrs.color)
        break
      case 'highlight':
        if (m.attrs.color) o.highlightColor = String(m.attrs.color)
        break
      case 'link': {
        const href = typeof m.attrs.href === 'string' ? sanitizeLinkHref(m.attrs.href) : undefined
        if (href) o.linkHref = href
        break
      }
      default:
        break
    }
  }
  return o
}

function textFragmentToJSON(text: string, run: TextRun): JSONContent {
  const marks: JSONContent[] = []
  if (run.bold) marks.push({ type: 'bold' })
  if (run.italic) marks.push({ type: 'italic' })
  if (run.underline) marks.push({ type: 'underline' })
  if (run.strikethrough) marks.push({ type: 'strike' })
  if (run.superscript) marks.push({ type: 'superscript' })
  if (run.subscript) marks.push({ type: 'subscript' })
  if (run.color?.trim()) marks.push({ type: 'textStyle', attrs: { color: run.color.trim() } })
  if (run.highlightColor?.trim()) {
    marks.push({ type: 'highlight', attrs: { color: run.highlightColor.trim() } })
  }
  if (run.linkHref) {
    const href = sanitizeLinkHref(run.linkHref)
    if (href) {
      marks.push({
        type: 'link',
        attrs: { href, target: '_blank', rel: 'noopener noreferrer' },
      })
    }
  }
  const node: JSONContent = { type: 'text', text }
  if (marks.length) {
    node.marks = marks as NonNullable<JSONContent['marks']>
  }
  return node
}

/** Serialize Agreemint rich runs to TipTap JSON (multiple paragraphs for newlines). */
export function runsToTipTapJSON(runs: RichRun[]): JSONContent {
  const paragraphs: JSONContent[] = []
  let current: JSONContent[] = []

  const flushParagraph = () => {
    paragraphs.push(
      current.length > 0
        ? { type: 'paragraph', content: current }
        : { type: 'paragraph' }
    )
    current = []
  }

  for (const run of runs) {
    if (run.type === 'var') {
      const varNode: JSONContent = {
        type: 'layoutVariable',
        attrs: { name: normalizeVariableIdentifier(run.name) },
      }
      // Propagate inline marks onto the atom so a subsequent edit session
      // opens the chip with the same bold / italic / underline / colour
      // styling the author left it with.
      const marks: NonNullable<JSONContent['marks']> = []
      if (run.bold) marks.push({ type: 'bold' })
      if (run.italic) marks.push({ type: 'italic' })
      if (run.underline) marks.push({ type: 'underline' })
      if (run.strikethrough) marks.push({ type: 'strike' })
      if (run.color) marks.push({ type: 'textStyle', attrs: { color: run.color } })
      if (run.highlightColor) marks.push({ type: 'highlight', attrs: { color: run.highlightColor } })
      if (run.linkHref) {
        const href = sanitizeLinkHref(run.linkHref)
        if (href) {
          marks.push({
            type: 'link',
            attrs: { href, target: '_blank', rel: 'noopener noreferrer' },
          })
        }
      }
      if (marks.length) varNode.marks = marks
      current.push(varNode)
      continue
    }
    const parts = (run.text ?? '').split('\n')
    parts.forEach((seg, i) => {
      if (seg.length > 0) {
        current.push(textFragmentToJSON(seg, run))
      }
      if (i < parts.length - 1) {
        // Newline → start a new paragraph
        flushParagraph()
      }
    })
  }

  // Flush the last paragraph
  flushParagraph()

  // ProseMirror forbids zero-length text nodes; an empty paragraph is the valid empty doc.
  if (paragraphs.length === 0) {
    return {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    }
  }
  return {
    type: 'doc',
    content: paragraphs,
  }
}

/** Read ALL paragraphs of a ProseMirror doc into Agreemint rich runs. */
export function pmDocToRuns(doc: PMNode): RichRun[] {
  if (doc.childCount === 0) {
    return [{ type: 'text', text: '' }]
  }
  const raw: RichRun[] = []
  let lastTextMarks: Partial<Omit<TextRun, 'type' | 'text'>> = {}

  doc.forEach((block, _offset, index) => {
    if (block.type.name !== 'paragraph') return

    // Insert newline between paragraphs
    if (index > 0) {
      raw.push({ type: 'text', text: '\n', ...lastTextMarks })
    }

    block.forEach((node) => {
      if (node.type.name === 'layoutVariable') {
        const name = String(node.attrs.name ?? '').trim()
        if (!name) return
        // Variable chips carry the same inline marks as text nodes — bold,
        // italic, underline, strike, colour, highlight, and link — so a
        // selection that covered the chip when the author toggled a mark
        // survives the round-trip through storage + reload.
        let href: string | undefined
        let varBold: boolean | undefined
        let varItalic: boolean | undefined
        let varUnderline: boolean | undefined
        let varStrike: boolean | undefined
        let varColor: string | undefined
        let varHighlight: string | undefined
        for (const m of node.marks) {
          switch (m.type.name) {
            case 'link': {
              const raw = typeof m.attrs.href === 'string' ? sanitizeLinkHref(m.attrs.href) : undefined
              if (raw) href = raw
              break
            }
            case 'bold':
              varBold = true
              break
            case 'italic':
              varItalic = true
              break
            case 'underline':
              varUnderline = true
              break
            case 'strike':
              varStrike = true
              break
            case 'textStyle':
              if (typeof m.attrs.color === 'string' && m.attrs.color) varColor = String(m.attrs.color)
              break
            case 'highlight':
              if (typeof m.attrs.color === 'string' && m.attrs.color) varHighlight = String(m.attrs.color)
              break
          }
        }
        raw.push({
          type: 'var',
          name,
          ...(href ? { linkHref: href } : {}),
          ...(varBold ? { bold: true } : {}),
          ...(varItalic ? { italic: true } : {}),
          ...(varUnderline ? { underline: true } : {}),
          ...(varStrike ? { strikethrough: true } : {}),
          ...(varColor ? { color: varColor } : {}),
          ...(varHighlight ? { highlightColor: varHighlight } : {}),
        })
        return
      }
      if (node.type.name === 'hardBreak') {
        raw.push({
          type: 'text',
          text: '\n',
          ...lastTextMarks,
        })
        return
      }
      if (node.isText) {
        const partial = marksToTextPartial(node.marks)
        lastTextMarks = partial
        raw.push({
          type: 'text',
          text: node.text ?? '',
          ...partial,
        })
      }
    })
  })

  return mergeAdjacentTextRuns(raw.length ? raw : [{ type: 'text', text: '' }])
}
