import type { CSSProperties } from 'react'
import {
  normalizeVariableIdentifier,
  parseContentToRuns,
} from '../../lib/richContent'

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
}) {
  const runs = parseContentToRuns(content)
  return (
    <div
      style={{
        fontSize,
        textAlign,
        color: color?.trim() || undefined,
        backgroundColor: backgroundColor?.trim() || undefined,
      }}
      className="min-w-0 overflow-hidden"
    >
      {runs.map((r, i) => {
        if (r.type === 'var') {
          const k = normalizeVariableIdentifier(r.name)
          const preview = variableValues[k] ?? ''
          const surface = variableSurfaceLabelResolver?.(k)?.trim()
          const label = surface || `{{${k}}}`
          const titleParts: string[] = []
          titleParts.push(`Token: {{${k}}}`)
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
            {r.text}
          </span>
        )
      })}
    </div>
  )
}
