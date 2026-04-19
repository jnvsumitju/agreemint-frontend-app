import type { CSSProperties, ReactNode } from 'react'
import { Fragment } from 'react'
import {
  normalizeVariableIdentifier,
  parseContentToRuns,
  sanitizeLinkHref,
} from '../../lib/richContent'
import { stripPipesFromKey } from '../../lib/variablePipes'
import { substituteVariables } from '../../lib/variables'

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
        // Resolve `{{var}}` placeholders inside the href at render time so
        // e.g. `https://crm/{{orderId}}` becomes a concrete URL in the
        // preview (and later in the PDF). Sanitised again to block any
        // unsafe protocol that a variable value might introduce.
        const resolvedHref = r.linkHref
          ? sanitizeLinkHref(substituteVariables(r.linkHref, variableValues))
          : undefined

        if (r.type === 'var') {
          const baseKey = stripPipesFromKey(r.name)
          const k = normalizeVariableIdentifier(baseKey)
          const preview = variableValues[k] ?? ''
          const surface = variableSurfaceLabelResolver?.(k)?.trim()
          const label = surface || `{{${k}}}`
          const titleParts: string[] = []
          titleParts.push(`Token: {{${r.name.trim()}}}`)
          if (preview.trim()) titleParts.push(`Variables tab preview: ${preview}`)
          if (r.linkHref) titleParts.push(`Link: ${r.linkHref}`)
          const chip = (
            <span className={varChipClass} data-am-var={k}>
              {label}
            </span>
          )
          return resolvedHref ? (
            <a
              key={i}
              href={resolvedHref}
              target="_blank"
              rel="noopener noreferrer"
              title={titleParts.join('\n')}
              // Stop the editor canvas from treating the click as a
              // select-element gesture while still letting the default
              // navigation run — the canvas listens for mousedown so
              // swallowing mousedown here is enough.
              onMouseDown={(e) => e.stopPropagation()}
              className="agreemint-link"
            >
              {chip}
            </a>
          ) : (
            <span key={i} title={titleParts.join('\n')}>{chip}</span>
          )
        }
        const deco: string[] = []
        if (r.underline) deco.push('underline')
        if (r.strikethrough) deco.push('line-through')
        // Linked runs get the underline by default unless the author has
        // explicitly set a different text-decoration state (strike stays).
        if (resolvedHref && !deco.includes('underline')) deco.push('underline')
        const spanNode = (
          <span
            style={{
              fontWeight: r.bold || elementBold ? 700 : 400,
              fontStyle: r.italic || elementItalic ? 'italic' : 'normal',
              textDecoration: deco.length ? deco.join(' ') : undefined,
              verticalAlign: r.superscript ? 'super' : r.subscript ? 'sub' : undefined,
              fontSize:
                r.superscript || r.subscript
                  ? `${Math.round((fontSize * 0.75 + Number.EPSILON) * 10) / 10}px`
                  : undefined,
              // If no explicit color, linked text falls back to a link-blue.
              color: r.color?.trim() || (resolvedHref ? '#2563eb' : undefined),
              backgroundColor: r.highlightColor?.trim() || undefined,
            }}
          >
            {renderTextWithBreaks(r.text)}
          </span>
        )
        if (!resolvedHref) {
          return <Fragment key={i}>{spanNode}</Fragment>
        }
        return (
          <a
            key={i}
            href={resolvedHref}
            target="_blank"
            rel="noopener noreferrer"
            title={r.linkHref && r.linkHref !== resolvedHref ? `Link: ${r.linkHref}` : undefined}
            onMouseDown={(e) => e.stopPropagation()}
            className="agreemint-link"
            style={{ color: 'inherit', textDecoration: 'inherit' }}
          >
            {spanNode}
          </a>
        )
      })}
    </div>
  )
}
