import type { CSSProperties } from 'react'

import type { ElementMeasurement } from '../../lib/api'
import { parseContentToRuns, type RichRun } from '../../lib/richContent'
import { RichTextBlockPreview } from './RichTextBlockPreview'

/**
 * Phase 1.5 renderer that replays iText's per-line layout by absolute-positioning
 * each measured line inside the element box. Guarantees that canvas and PDF
 * wrap at the same character (pixel-perfect) as long as:
 *   1) `measurement.textLines` arrived from the backend measurement endpoint
 *   2) The element isn't in TipTap edit mode
 *
 * When either condition fails — measurement missing / stale, or user is actively
 * editing — we fall through to the flow-based {@link RichTextBlockPreview}. The
 * frontend accepts a single-frame flicker on edit-then-blur because absolute
 * positioning + contenteditable don't coexist cleanly; the PDF always reflects
 * the measured geometry so legal-artifact parity is maintained.
 */
export function RichTextAbsoluteLines({
  content,
  measurement,
  variableValues,
  variableSurfaceLabelResolver,
  fontSize,
  textAlign,
  elementBold,
  elementItalic,
  color,
  backgroundColor,
  fontFamily,
  lineHeight,
}: {
  content: string | undefined
  measurement: ElementMeasurement | undefined
  variableValues: Record<string, string>
  variableSurfaceLabelResolver?: (rawName: string) => string
  fontSize: number
  textAlign: CSSProperties['textAlign']
  elementBold?: boolean
  elementItalic?: boolean
  color?: string
  backgroundColor?: string
  fontFamily?: string
  lineHeight?: number
}) {
  const fallbackProps = {
    content,
    variableValues,
    variableSurfaceLabelResolver,
    fontSize,
    textAlign,
    elementBold,
    elementItalic,
    color,
    backgroundColor,
    fontFamily,
    lineHeight,
  }

  // No usable measurement → flow-based preview. Covers the cold-start window
  // before the first measurement round-trip completes AND the flag-off path.
  if (!measurement || !measurement.textLines || measurement.textLines.length === 0) {
    return <RichTextBlockPreview {...fallbackProps} />
  }

  const runs = parseContentToRuns(content)

  return (
    <div
      // `h-full w-full` so this wrapper fills the parent element box — without
      // it the `relative` + `absolute` children + `overflow-hidden` trio
      // collapses the container to height 0 and every line gets clipped.
      className="relative h-full w-full min-w-0 overflow-hidden"
      style={{
        fontSize,
        fontFamily: fontFamily || undefined,
        color: color?.trim() || undefined,
        backgroundColor: backgroundColor?.trim() || undefined,
        lineHeight: lineHeight ?? 1.4,
        textAlign,
      }}
    >
      {measurement.textLines.map((line, lineIdx) => (
        <div
          key={lineIdx}
          className="absolute left-0 right-0"
          style={{
            // The canvas renders at 1 CSS px = 1 pt (base plan section 4). y/h
            // arrive in pt from the backend; we consume them as `px` directly.
            top: `${line.y}px`,
            height: `${line.h}px`,
            textAlign,
            whiteSpace: 'nowrap',
          }}
        >
          {line.runs.map((m, runIdx) => {
            const authored: RichRun | undefined = m.runIndex >= 0 ? runs[m.runIndex] : undefined
            return (
              <AbsoluteRunSpan
                key={runIdx}
                rendered={m.text}
                width={m.width}
                authored={authored}
                elementBold={elementBold}
                elementItalic={elementItalic}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

function AbsoluteRunSpan({
  rendered,
  width,
  authored,
  elementBold,
  elementItalic,
}: {
  rendered: string
  width: number
  authored: RichRun | undefined
  elementBold?: boolean
  elementItalic?: boolean
}) {
  // Discriminated-union narrow: the `text` variant carries the style props we
  // need. Variable runs render as plain rendered text (the variable chip
  // decoration is editor-preview-only; iText emits the resolved value).
  const asText = authored?.type === 'text' ? authored : undefined
  const deco: string[] = []
  if (asText?.underline) deco.push('underline')
  if (asText?.strikethrough) deco.push('line-through')
  const isBold = asText?.bold ?? elementBold
  const isItalic = asText?.italic ?? elementItalic
  // Inline-block with an explicit width locks the span to the advance width
  // iText measured, so sub-glyph drift in the browser's own text metrics
  // can't push the next run onto a different column.
  const style: CSSProperties = {
    display: 'inline-block',
    width: `${width}px`,
    fontWeight: isBold ? 700 : 400,
    fontStyle: isItalic ? 'italic' : 'normal',
    textDecoration: deco.length ? deco.join(' ') : undefined,
    color: asText?.color?.trim() || undefined,
    backgroundColor: asText?.highlightColor?.trim() || undefined,
    // overflow:hidden prevents a rendered shard from painting over the next run
    // when the browser's CSS text rendering disagrees with iText by a fraction
    // of a pt on the final glyph.
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    verticalAlign: 'baseline',
  }
  return <span style={style}>{rendered}</span>
}
