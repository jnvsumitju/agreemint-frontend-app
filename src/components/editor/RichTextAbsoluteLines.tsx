import type { CSSProperties } from 'react'
import { useEditorStore } from '../../stores/editorStore'

import type { ElementMeasurement } from '../../lib/api'
import {
  normalizeVariableIdentifier,
  parseContentToRuns,
  type RichRun,
} from '../../lib/richContent'
import { stripPipesFromKey } from '../../lib/variablePipes'
import { RichTextBlockPreview } from './RichTextBlockPreview'

// `font-medium` dropped so the chip inherits the textbox typography —
// element-level bold/italic/underline/strike apply to vars automatically.
const varChipClass =
  'inline rounded bg-violet-100 px-1 py-px text-[0.92em] text-violet-900 ring-1 ring-violet-300/80 dark:bg-violet-950/70 dark:text-violet-100 dark:ring-violet-700/80'

/**
 * How a merge field should be decorated.
 *
 * <p>With the Values toggle on, the span carries the document's own text, so
 * the violet pill is actively wrong — twenty of them across a certificate read
 * as clutter rather than as information, and it is the first thing a visitor
 * sees on a landing page. Off, the pill is the whole point: it is what tells
 * you which words are fields.
 *
 * <p>So the toggle switches mode rather than just wording. Values on: read the
 * document. Values off: see the wiring.
 */
function useVarChipClass(): string {
  const showValues = useEditorStore((s) => s.showVariableValues)
  return showValues ? 'inline' : varChipClass
}

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
  elementUnderline,
  elementStrikethrough,
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
  elementUnderline?: boolean
  elementStrikethrough?: boolean
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
    elementUnderline,
    elementStrikethrough,
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

  // Staleness guard: after a content edit (e.g. inserting an `@variable`
  // chip on blur, or a remote collab mutation) the measurement hasn't
  // caught up — it still lists runs from BEFORE the edit. Rendering
  // absolute-positioned lines against a stale textLines array silently
  // drops any run the measurement doesn't know about (new variables
  // disappear from the canvas until the backend re-measures).
  //
  // Detect the divergence: every authored-run index must appear in the
  // measurement. If even one is missing, fall through to the flow-based
  // preview which doesn't depend on measurement geometry and renders
  // variable chips natively.
  const seenRunIndices = new Set<number>()
  for (const line of measurement.textLines) {
    for (const r of line.runs) seenRunIndices.add(r.runIndex)
  }
  const measurementIsStale = runs.some((_, i) => !seenRunIndices.has(i))
  if (measurementIsStale) {
    return <RichTextBlockPreview {...fallbackProps} />
  }

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
            // Var runs render as violet chips in view mode — matches the
            // flow-preview behavior so the author always sees WHICH runs
            // are variables, even if the resolved text is empty (iText
            // couldn't look up the name → `m.text` is "" → a plain text
            // span would be invisible).
            if (authored?.type === 'var') {
              return (
                <AbsoluteVarChip
                  key={runIdx}
                  authored={authored}
                  variableValues={variableValues}
                  variableSurfaceLabelResolver={variableSurfaceLabelResolver}
                  elementBold={elementBold}
                  elementItalic={elementItalic}
                  elementUnderline={elementUnderline}
                  elementStrikethrough={elementStrikethrough}
                />
              )
            }
            return (
              <AbsoluteRunSpan
                key={runIdx}
                rendered={m.text}
                width={m.width}
                authored={authored}
                elementBold={elementBold}
                elementItalic={elementItalic}
                elementUnderline={elementUnderline}
                elementStrikethrough={elementStrikethrough}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

function AbsoluteVarChip({
  authored,
  variableValues,
  variableSurfaceLabelResolver,
  elementBold,
  elementItalic,
  elementUnderline,
  elementStrikethrough,
}: {
  authored: RichRun & { type: 'var' }
  variableValues: Record<string, string>
  variableSurfaceLabelResolver?: (rawName: string) => string
  elementBold?: boolean
  elementItalic?: boolean
  elementUnderline?: boolean
  elementStrikethrough?: boolean
}) {
  const chipClass = useVarChipClass()
  const baseKey = stripPipesFromKey(authored.name)
  const k = normalizeVariableIdentifier(baseKey)
  const surface = variableSurfaceLabelResolver?.(k)?.trim()
  const label = surface || `{{${k}}}`
  const preview = variableValues[k] ?? ''
  const titleParts: string[] = [`Token: {{${authored.name.trim()}}}`]
  if (preview.trim()) titleParts.push(`Variables tab preview: ${preview}`)
  // Chip takes its natural width instead of the backend-measured advance.
  // The measurement reports the width iText would emit for the RESOLVED
  // value (often shorter than the chip label, sometimes zero if the value
  // doesn't resolve) — using that width caused adjacent chips to stack on
  // top of each other in view mode. In the PDF the var prints its resolved
  // text at the measured width, so PDF parity for vars is handled server-
  // side anyway; the canvas chip is purely an authoring affordance.
  const wrapStyle: CSSProperties = {
    display: 'inline-block',
    whiteSpace: 'nowrap',
    verticalAlign: 'baseline',
  }
  // Run-level marks on the var override element-level marks; either drives
  // the chip's typography so selection-scoped styling + textbox-scoped
  // styling both land on chips in view mode.
  const chipBold = authored.bold ?? elementBold
  const chipItalic = authored.italic ?? elementItalic
  const chipUnderlined = authored.underline ?? elementUnderline
  const chipStruck = authored.strikethrough ?? elementStrikethrough
  const chipDeco: string[] = []
  if (chipUnderlined) chipDeco.push('underline')
  if (chipStruck) chipDeco.push('line-through')
  const chipStyle: CSSProperties = {
    fontWeight: chipBold ? 700 : undefined,
    fontStyle: chipItalic ? 'italic' : undefined,
    textDecoration: chipDeco.length ? chipDeco.join(' ') : undefined,
    color: authored.color?.trim() || undefined,
    backgroundColor: authored.highlightColor?.trim() || undefined,
  }
  return (
    <span style={wrapStyle} title={titleParts.join('\n')} data-am-var={k}>
      <span className={chipClass} style={chipStyle}>{label}</span>
    </span>
  )
}

function AbsoluteRunSpan({
  rendered,
  width,
  authored,
  elementBold,
  elementItalic,
  elementUnderline,
  elementStrikethrough,
}: {
  rendered: string
  width: number
  authored: RichRun | undefined
  elementBold?: boolean
  elementItalic?: boolean
  elementUnderline?: boolean
  elementStrikethrough?: boolean
}) {
  // Discriminated-union narrow: the `text` variant carries the style props we
  // need. Variable runs render as plain rendered text (the variable chip
  // decoration is editor-preview-only; iText emits the resolved value).
  const asText = authored?.type === 'text' ? authored : undefined
  const deco: string[] = []
  // Tri-state nullish fallback: a run with an explicit bold/italic/underline
  // /strikethrough value overrides the element-level style in either direction.
  // A run with the mark absent (undefined) falls through to the element
  // default. This lets an author bold a whole paragraph and then un-bold a
  // specific selection inside it, or vice versa. The earlier 2-state setup
  // (`bold: !!r.bold` in normalizeRun) made this impossible; normalizeRun now
  // preserves undefined, so `??` does what the name suggests.
  if ((asText?.underline ?? elementUnderline)) deco.push('underline')
  if ((asText?.strikethrough ?? elementStrikethrough)) deco.push('line-through')
  const isBold = asText?.bold ?? elementBold
  const isItalic = asText?.italic ?? elementItalic
  // Inline-block with an explicit width reserves iText's measured advance
  // width for this run, so the NEXT run starts at the exact pt iText will
  // emit. Ink that naturally extends past the advance box (italic lean,
  // serif curls, descender tails, combining diacritics) is allowed to
  // render with `overflow: visible` — clipping it truncated the final glyph
  // of italic / serif runs (e.g. "Sumit Kumar" cut to "Sumit Kuma"). PDF
  // never clipped those pixels either, so visible overflow is the parity-
  // correct behaviour.
  const runFontSize =
    typeof asText?.fontSize === 'number' && asText.fontSize > 0 ? asText.fontSize : undefined
  const style: CSSProperties = {
    display: 'inline-block',
    width: `${width}px`,
    fontWeight: isBold ? 700 : 400,
    fontStyle: isItalic ? 'italic' : 'normal',
    textDecoration: deco.length ? deco.join(' ') : undefined,
    color: asText?.color?.trim() || undefined,
    backgroundColor: asText?.highlightColor?.trim() || undefined,
    // Per-run font size override; the outer container's fontSize is the
    // default that most runs inherit. When a run has a different size the
    // span renders it locally — iText is fed the same value through the
    // serialized `fontSize` field so canvas and PDF agree.
    ...(runFontSize != null ? { fontSize: `${runFontSize}px` } : {}),
    overflow: 'visible',
    whiteSpace: 'nowrap',
    verticalAlign: 'baseline',
  }
  return <span style={style}>{rendered}</span>
}
