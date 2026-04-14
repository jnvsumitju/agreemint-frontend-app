/**
 * Linked text frame reflow utilities.
 *
 * When a TEXT element's content overflows its page boundary, the content is split
 * at paragraph boundaries and continued on subsequent pages via linked elements.
 * Editing any element in a linked chain triggers a full redistribution from the head.
 */

import { parseContentToRuns, serializeRunsToContent, type RichRun } from './richContent'

// ── Content splitting ──────────────────────────────────────────────────────────

/**
 * Split a rich content string into per-paragraph content strings.
 * Each returned string is a self-contained serialized rich content JSON.
 */
export function splitContentIntoParagraphs(content: string): string[] {
  const runs = parseContentToRuns(content)
  if (runs.length === 0) return [content]

  const groups: RichRun[][] = [[]]

  for (const run of runs) {
    if (run.type === 'var') {
      groups[groups.length - 1].push(run)
      continue
    }
    const text = run.text ?? ''
    const parts = text.split('\n')
    parts.forEach((seg, i) => {
      if (i > 0) groups.push([]) // new paragraph
      if (seg.length > 0) {
        groups[groups.length - 1].push({ ...run, text: seg })
      }
    })
  }

  return groups.map((g) =>
    g.length > 0
      ? serializeRunsToContent(g)
      : serializeRunsToContent([{ type: 'text', text: '' }])
  )
}

/**
 * Join multiple paragraph content strings into a single content string
 * (with `\n` between paragraphs).
 */
export function joinParagraphContents(paragraphs: string[]): string {
  if (paragraphs.length === 0) return serializeRunsToContent([{ type: 'text', text: '' }])
  if (paragraphs.length === 1) return paragraphs[0]

  const allRuns: RichRun[] = []
  for (let i = 0; i < paragraphs.length; i++) {
    if (i > 0) allRuns.push({ type: 'text', text: '\n' })
    allRuns.push(...parseContentToRuns(paragraphs[i]))
  }
  return serializeRunsToContent(allRuns)
}

// ── Measurement ────────────────────────────────────────────────────────────────

/**
 * Extract plain text from a rich content string (variable chips rendered as `{{name}}`).
 */
function contentToPlainText(content: string): string {
  const runs = parseContentToRuns(content)
  return runs.map((r) => (r.type === 'var' ? `{{${r.name}}}` : r.text)).join('')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Build an off-screen measurement container matching the text element's rendering.
 * Caller must append to DOM, read measurements, then remove.
 */
function createMeasurementContainer(
  widthPx: number,
  style: { fontSize?: number; fontFamily?: string; bold?: boolean; italic?: boolean }
): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = [
    'position:absolute',
    'left:-9999px',
    'top:0',
    `width:${widthPx}px`,
    'padding:2px 4px', // py-0.5 px-1 — matches TEXT element container
    `font-size:${style.fontSize ?? 12}px`,
    `font-family:${style.fontFamily || 'ui-sans-serif, system-ui, sans-serif'}`,
    `font-weight:${style.bold ? 700 : 400}`,
    `font-style:${style.italic ? 'italic' : 'normal'}`,
    'line-height:normal',
    'word-break:break-word',
    'visibility:hidden',
    'box-sizing:border-box',
  ].join(';')
  return el
}

/**
 * Measure how tall each paragraph renders in a container of the given width.
 * Returns pixel heights, one per paragraph.
 */
export function measureParagraphHeights(
  paragraphs: string[],
  containerWidthPx: number,
  style: { fontSize?: number; fontFamily?: string; bold?: boolean; italic?: boolean }
): number[] {
  if (paragraphs.length === 0) return []

  const container = createMeasurementContainer(containerWidthPx, style)
  const divs: HTMLDivElement[] = []

  for (const para of paragraphs) {
    const d = document.createElement('div')
    const plain = contentToPlainText(para)
    // Use innerHTML so that empty paragraphs get a measurable height via &nbsp;
    d.innerHTML = escapeHtml(plain) || '&nbsp;'
    container.appendChild(d)
    divs.push(d)
  }

  document.body.appendChild(container)
  const heights = divs.map((d) => d.offsetHeight)
  document.body.removeChild(container)
  return heights
}

/**
 * Measure the rendered height of a full content string.
 */
export function measureContentHeight(
  content: string,
  containerWidthPx: number,
  style: { fontSize?: number; fontFamily?: string; bold?: boolean; italic?: boolean }
): number {
  const container = createMeasurementContainer(containerWidthPx, style)
  const plain = contentToPlainText(content)
  // Render with \n as <br> so paragraphs wrap correctly
  const lines = plain.split('\n')
  container.innerHTML = lines.map((l) => escapeHtml(l) || '&nbsp;').join('<br>')

  document.body.appendChild(container)
  const h = container.offsetHeight
  document.body.removeChild(container)
  return h
}

// ── Distribution ───────────────────────────────────────────────────────────────

/**
 * Given paragraph heights and a max height for the container,
 * return how many paragraphs fit. Always returns at least 1
 * (a single paragraph is never split).
 */
export function countParagraphsThatFit(
  paragraphHeights: number[],
  maxHeight: number
): number {
  if (paragraphHeights.length === 0) return 0
  let cum = 0
  for (let i = 0; i < paragraphHeights.length; i++) {
    cum += paragraphHeights[i]
    if (cum > maxHeight) {
      return Math.max(1, i) // At least 1 paragraph per frame
    }
  }
  return paragraphHeights.length // All fit
}

/**
 * Result of a reflow computation for a single linked chain.
 */
export interface ReflowFrame {
  /** Which paragraphs this frame contains (start inclusive, end exclusive). */
  paragraphStart: number
  paragraphEnd: number
  /** Content string for this frame. */
  content: string
  /** Measured pixel height of this frame's content. */
  measuredHeight: number
}

/**
 * Distribute paragraphs across frames based on available heights.
 *
 * @param paragraphs - Individual paragraph content strings (from splitContentIntoParagraphs)
 * @param headMaxHeight - Available height for the first (head) frame
 * @param continuationMaxHeight - Available height for continuation frames
 * @param containerWidth - Element width in px
 * @param style - Element font style
 * @returns Array of ReflowFrame entries
 */
export function distributeContent(
  paragraphs: string[],
  headMaxHeight: number,
  continuationMaxHeight: number,
  containerWidth: number,
  style: { fontSize?: number; fontFamily?: string; bold?: boolean; italic?: boolean }
): ReflowFrame[] {
  if (paragraphs.length === 0) {
    return [
      {
        paragraphStart: 0,
        paragraphEnd: 0,
        content: serializeRunsToContent([{ type: 'text', text: '' }]),
        measuredHeight: 16,
      },
    ]
  }

  const allHeights = measureParagraphHeights(paragraphs, containerWidth, style)
  const frames: ReflowFrame[] = []
  let idx = 0

  while (idx < paragraphs.length) {
    const isHead = frames.length === 0
    const maxH = isHead ? headMaxHeight : continuationMaxHeight
    const remaining = allHeights.slice(idx)
    const count = countParagraphsThatFit(remaining, maxH)
    const endIdx = idx + count

    const frameParagraphs = paragraphs.slice(idx, endIdx)
    const content = joinParagraphContents(frameParagraphs)
    const measuredHeight = measureContentHeight(content, containerWidth, style)

    frames.push({
      paragraphStart: idx,
      paragraphEnd: endIdx,
      content,
      measuredHeight,
    })

    idx = endIdx
  }

  return frames
}
