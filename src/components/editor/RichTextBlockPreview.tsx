import type { CSSProperties, ReactNode } from 'react'
import { Fragment } from 'react'
import {
  normalizeVariableIdentifier,
  parseContentToRuns,
} from '../../lib/richContent'
import { stripPipesFromKey } from '../../lib/variablePipes'

/** Render text with \n as <br/> so multi-line content shows in the preview. */
function renderTextWithBreaks(text: string): ReactNode {
  if (!text.includes('\n')) return text
  const parts = text.split('\n')
  return parts.map((seg, i) => (
    <Fragment key={i}>
      {seg}
      {i < parts.length - 1 && <br />}
    </Fragment>
  ))
}

const varChipClass =
  'inline rounded bg-violet-100 px-1 py-px text-[0.92em] font-medium text-violet-900 ring-1 ring-violet-300/80 dark:bg-violet-950/70 dark:text-violet-100 dark:ring-violet-700/80'

/** Read-only rich text for canvas / table cells (variables as chips; preview in title). */
export function RichTextBlockPreview({
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
}: {
  content: string | undefined
  variableValues: Record<string, string>
  /** When set, merge fields render as violet chips with the same labels as inline edit. */
  variableSurfaceLabelResolver?: (rawName: string) => string
  fontSize: number
  textAlign: CSSProperties['textAlign']
  elementBold?: boolean
  elementItalic?: boolean
  color?: string
  backgroundColor?: string
  fontFamily?: string
  /** Line-height multiplier (e.g. 1.4). */
  lineHeight?: number
}) {
  const runs = parseContentToRuns(content)
  return (
    <div
      style={{
        fontSize,
        textAlign,
        fontFamily: fontFamily || undefined,
        color: color?.trim() || undefined,
        backgroundColor: backgroundColor?.trim() || undefined,
        lineHeight: lineHeight ?? 1.4,
      }}
      className="min-w-0 overflow-hidden"
    >
      {runs.map((r, i) => {
        if (r.type === 'var') {
          const baseKey = stripPipesFromKey(r.name)
          const k = normalizeVariableIdentifier(baseKey)
          const preview = variableValues[k] ?? ''
          const surface = variableSurfaceLabelResolver?.(k)?.trim()
          const label = surface || `{{${k}}}`
          const titleParts: string[] = []
          titleParts.push(`Token: {{${r.name.trim()}}}`)
          if (preview.trim()) titleParts.push(`Variables tab preview: ${preview}`)
          return (
            <span
              key={i}
              className={varChipClass}
              title={titleParts.join('\n')}
              data-am-var={k}
            >
              {label}
            </span>
          )
        }
        const deco: string[] = []
        if (r.underline) deco.push('underline')
        if (r.strikethrough) deco.push('line-through')
        return (
          <span
            key={i}
            style={{
              fontWeight: r.bold || elementBold ? 700 : 400,
              fontStyle: r.italic || elementItalic ? 'italic' : 'normal',
              textDecoration: deco.length ? deco.join(' ') : undefined,
              verticalAlign: r.superscript ? 'super' : r.subscript ? 'sub' : undefined,
              fontSize:
                r.superscript || r.subscript
                  ? `${Math.round((fontSize * 0.75 + Number.EPSILON) * 10) / 10}px`
                  : undefined,
              color: r.color?.trim() || undefined,
              backgroundColor: r.highlightColor?.trim() || undefined,
            }}
          >
            {renderTextWithBreaks(r.text)}
          </span>
        )
      })}
    </div>
  )
}
