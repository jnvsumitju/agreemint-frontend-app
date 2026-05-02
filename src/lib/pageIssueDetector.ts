import { pageDimensionsPt, type LayoutDocumentPage, type LayoutElement, type PageSpec } from '../types/layout'
import { measureContentHeight } from './textReflow'
import { parseContentToRuns } from './richContent'

/**
 * Lightweight client-side detector for the visual issues that the AI's
 * dense-document generation routinely leaves behind:
 *
 *   - element overlaps (vertical/horizontal collision after rendering)
 *   - off-page elements (extends past printable margins)
 *   - glued lowercase text ("DISBURSEMENTTERMS", "Borroweronlyupon...")
 *   - height drift (stored height << measured rendered height)
 *
 * Used by the per-page "Fix layout" badge: detect → if any issues, show
 * them to the user and offer to send them + the page JSON to DeepSeek for
 * a focused correction pass. The detector is deterministic and runs
 * entirely on the client; we only call the model once we know there's
 * something specific to fix, so no AI tokens get spent on clean pages.
 */

export type PageIssue =
  | {
      kind: 'overlap'
      elementId: string
      otherId: string
      /** Vertical pixels of overlap between the two elements' bounding boxes. */
      overlapPt: number
      label: string
    }
  | {
      kind: 'overflow_bottom'
      elementId: string
      /** Pixels the element extends past the bottom margin. */
      overflowPt: number
      label: string
    }
  | {
      kind: 'overflow_horizontal'
      elementId: string
      side: 'left' | 'right'
      overflowPt: number
      label: string
    }
  | {
      kind: 'height_drift'
      elementId: string
      storedHeight: number
      measuredHeight: number
      label: string
    }
  | {
      kind: 'glued_text'
      elementId: string
      sample: string
      label: string
    }

export type PageIssueReport = {
  pageId: string
  pageIndex: number
  issues: PageIssue[]
  /** Element-id → measured rendered height (only populated for measured elements). */
  measuredHeights: Record<string, number>
}

/** Plain-text preview of an element, capped to N chars. */
function elementLabel(el: LayoutElement, max = 40): string {
  if (typeof el.content === 'string' && el.content) {
    try {
      const runs = parseContentToRuns(el.content)
      const joined = runs
        .map((r) => (r.type === 'text' ? r.text : r.type === 'var' ? `{${r.name}}` : ''))
        .join('')
        .trim()
      if (joined) return joined.length > max ? joined.slice(0, max) + '…' : joined
    } catch {
      /* fall through */
    }
  }
  if (Array.isArray(el.listItems) && el.listItems.length > 0) {
    const t = (el.listItems[0]?.text ?? '').trim()
    if (t) return t.length > max ? t.slice(0, max) + '…' : t
  }
  return `${el.type} element`
}

/**
 * Look for runs of consecutive letters with no space — likely missing word
 * boundaries. Thresholds vary by script:
 *   - Latin lower/upper: ≥14 chars (above the longest common English word)
 *   - Devanagari (Hindi, Marathi, Sanskrit): ≥40 chars (Hindi sentences
 *     average 4–8 chars per word with spaces, so 40+ unbroken is suspicious)
 *   - Arabic / Hebrew: ≥35 chars (similar reasoning)
 *   - Cyrillic / Greek: ≥18 chars (room for compound German-style words)
 *
 * NOT applied to CJK (Chinese/Japanese/Thai/Korean) which legitimately
 * lack inter-word ASCII spaces.
 */
function detectGluedText(text: string | undefined): string | null {
  if (!text) return null
  const checks: Array<{ re: RegExp; label?: string }> = [
    { re: /[a-z]{14,}/ },
    { re: /[A-Z]{14,}/ },
    // Devanagari + Vedic Extensions
    { re: /[ऀ-ॿ᳐-᳿]{40,}/ },
    // Arabic, Arabic Supplement, Arabic Extended
    { re: /[؀-ۿݐ-ݿࢠ-ࣿ]{35,}/ },
    // Hebrew
    { re: /[֐-׿]{35,}/ },
    // Cyrillic
    { re: /[Ѐ-ӿ]{18,}/ },
    // Greek + Coptic
    { re: /[Ͱ-Ͽ]{18,}/ },
  ]
  for (const c of checks) {
    const m = text.match(c.re)
    if (m) return m[0]
  }
  return null
}

function flatTextOf(el: LayoutElement): string {
  if (typeof el.content === 'string' && el.content) {
    try {
      const runs = parseContentToRuns(el.content)
      return runs
        .map((r) => (r.type === 'text' ? r.text ?? '' : ''))
        .join('')
    } catch {
      return el.content
    }
  }
  if (Array.isArray(el.listItems)) {
    return el.listItems.map((li) => li.text ?? '').join('\n')
  }
  return ''
}

/**
 * Run the issue checks against a single page. Returns an empty {@code issues}
 * array on a clean page so the caller can short-circuit ("page looks good").
 */
export function detectPageIssues(
  page: LayoutDocumentPage,
  pageIndex: number,
  pageSpec: PageSpec,
): PageIssueReport {
  const issues: PageIssue[] = []
  const measured: Record<string, number> = {}

  // ── Pass 1: per-element checks (overflow, glued text, height drift) ──
  const m = pageSpec.margins
  const dims = pageDimensionsPt(pageSpec)
  const minX = m.left
  const maxX = dims.width - m.right
  const maxY = dims.height - m.bottom

  for (const el of page.elements) {
    // Skip element types that legitimately sit outside the printable area.
    const ignoresMargins = el.type === 'HEADER' || el.type === 'FOOTER' || el.type === 'FLOATING'

    // Glued-text check on text-bearing elements.
    if (el.type === 'TEXT' || el.type === 'HEADER' || el.type === 'FOOTER' || el.type === 'FLOATING') {
      const flat = flatTextOf(el)
      const sample = detectGluedText(flat)
      if (sample) {
        issues.push({ kind: 'glued_text', elementId: el.id, sample, label: elementLabel(el) })
      }
    }

    // Height-drift + overflow checks need a measured rendered height for
    // text elements (the stored .height is the AI's estimate and is often
    // wrong by 2-3x on wrapped paragraphs).
    let effectiveHeight = el.height
    if (el.type === 'TEXT' || el.type === 'HEADER' || el.type === 'FOOTER' || el.type === 'FLOATING') {
      if (el.content) {
        try {
          const h = measureContentHeight(el.content, el.width, el.style ?? {})
          if (Number.isFinite(h) && h > 0) {
            measured[el.id] = h
            effectiveHeight = Math.max(el.height, h)
            // Drift is meaningful only if the measured height materially
            // exceeds the stored one — don't pester the AI about a 2pt gap.
            if (h > el.height + 12) {
              issues.push({
                kind: 'height_drift',
                elementId: el.id,
                storedHeight: el.height,
                measuredHeight: h,
                label: elementLabel(el),
              })
            }
          }
        } catch {
          /* measurement failed — skip */
        }
      }
    }

    if (!ignoresMargins) {
      // Bottom overflow uses the effective (measured) height, since the AI's
      // stored height is what made the layout look fine to it; we want the
      // real visible bottom edge.
      const bottom = el.y + effectiveHeight
      if (bottom > maxY + 4) {
        issues.push({
          kind: 'overflow_bottom',
          elementId: el.id,
          overflowPt: Math.round(bottom - maxY),
          label: elementLabel(el),
        })
      }
      if (el.x < minX - 4) {
        issues.push({
          kind: 'overflow_horizontal',
          elementId: el.id,
          side: 'left',
          overflowPt: Math.round(minX - el.x),
          label: elementLabel(el),
        })
      }
      if (el.x + el.width > maxX + 4) {
        issues.push({
          kind: 'overflow_horizontal',
          elementId: el.id,
          side: 'right',
          overflowPt: Math.round(el.x + el.width - maxX),
          label: elementLabel(el),
        })
      }
    }
  }

  // ── Pass 2: pairwise overlap detection ──
  // Use measured heights so wrapped paragraphs don't appear non-colliding
  // against a sibling whose stored height was 24pt but renders at 80pt.
  const HORIZ_TOLERANCE = 4
  const VERT_TOLERANCE = 2
  const reported = new Set<string>()
  const heightOf = (e: LayoutElement) => Math.max(e.height, measured[e.id] ?? 0)
  for (let i = 0; i < page.elements.length; i++) {
    const a = page.elements[i]
    for (let j = i + 1; j < page.elements.length; j++) {
      const b = page.elements[j]
      const horizOverlap =
        a.x < b.x + b.width - HORIZ_TOLERANCE &&
        a.x + a.width > b.x + HORIZ_TOLERANCE
      if (!horizOverlap) continue
      const aBottom = a.y + heightOf(a)
      const bBottom = b.y + heightOf(b)
      const vertOverlap =
        a.y < bBottom - VERT_TOLERANCE && aBottom > b.y + VERT_TOLERANCE
      if (!vertOverlap) continue
      // Compute overlap depth — useful for the AI to know whether to nudge
      // 8pt or rebuild.
      const overlapDepth = Math.min(aBottom, bBottom) - Math.max(a.y, b.y)
      // Dedupe (a,b) and (b,a).
      const key = a.id < b.id ? `${a.id}::${b.id}` : `${b.id}::${a.id}`
      if (reported.has(key)) continue
      reported.add(key)
      issues.push({
        kind: 'overlap',
        elementId: a.id,
        otherId: b.id,
        overlapPt: Math.round(overlapDepth),
        label: `${elementLabel(a, 24)} ↔ ${elementLabel(b, 24)}`,
      })
    }
  }

  return { pageId: page.id, pageIndex, issues, measuredHeights: measured }
}

/** Human-readable one-liner for showing in the issues popover. */
export function describeIssue(issue: PageIssue): string {
  switch (issue.kind) {
    case 'overlap':
      return `Overlapping elements (${issue.overlapPt}pt deep): ${issue.label}`
    case 'overflow_bottom':
      return `Element extends ${issue.overflowPt}pt past the bottom margin: "${issue.label}"`
    case 'overflow_horizontal':
      return `Element extends ${issue.overflowPt}pt past the ${issue.side} margin: "${issue.label}"`
    case 'height_drift':
      return `Stored height ${issue.storedHeight}pt but renders at ${issue.measuredHeight}pt: "${issue.label}"`
    case 'glued_text':
      return `Missing spaces in text "${issue.sample}…" (in: "${issue.label}")`
  }
}
