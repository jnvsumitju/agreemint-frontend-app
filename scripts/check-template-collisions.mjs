/**
 * Flag text that will visually collide in the rendered document.
 *
 * <p>An earlier attempt compared element *boxes* and was useless: a
 * right-aligned value box routinely spans the same rectangle as its
 * left-aligned label, and neither's glyphs come near the other. It reported 124
 * "overlaps" across the catalogue, every one of them a false positive.
 *
 * <p>So this models the ink instead. For each element it resolves the preview
 * values, wraps the text the way the box will, and computes one rectangle per
 * rendered LINE — placed within the box according to the element's alignment.
 * Two elements collide only when their line rectangles actually intersect.
 *
 * <p>This is the check that would have caught the marksheet shipping with
 * "Technology" printed on top of its own address line: no element overflowed
 * its box, so the overflow check was silent, but two boxes' contents landed in
 * the same place.
 *
 * <p>Widths are estimated, not measured — there is no font engine here — so
 * treat output as candidates to look at, not proof. The thresholds are set to
 * favour silence over noise: a collision has to be worth a human's attention in
 * both axes before it is reported.
 *
 * <p>Used two ways: {@link findCollisions} is called by the generator against
 * the elements it just built, so a bad layout fails generation rather than
 * being written to disk; running this file directly re-checks whatever is
 * already in `src/try-templates/`.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = join(HERE, '..', 'src', 'try-templates')

/** Deliberately on the low side: under-estimating width avoids false positives. */
const AVG_ADVANCE_EM = { 'Inter': 0.5, 'Source Serif 4': 0.48, 'JetBrains Mono': 0.6 }

/** Ink must overlap by more than this in BOTH axes before it counts. */
const MIN_OVERLAP_PT = 2

/**
 * Fraction of the em the glyphs actually occupy, cap-height to descender.
 *
 * <p>A line BOX is `fontSize × lineHeight` and the glyphs sit inside it with
 * the leading split above and below. Treating the whole box as ink reported a
 * 24pt heading as colliding with the paragraph 2.8pt below it, when the render
 * shows the descender of "Agreement" clearing the next line comfortably.
 */
const INK_BAND_EM = 1.0

const TEXT_LIKE = new Set(['TEXT', 'PARAGRAPH', 'HEADER', 'FOOTER', 'FLOATING'])

function resolve(content, values) {
  return String(content ?? '').replace(
    /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,
    (m, k) => values[k] ?? m
  )
}

/** One rectangle per rendered line, positioned by the element's alignment. */
function inkRects(el, values) {
  const style = el.style ?? {}
  const fontSize = style.fontSize ?? 10
  const lineHeight = style.lineHeight ?? 1.45
  const width = el.width ?? 0
  if (!(width > 0) || typeof el.content !== 'string') return []

  const em = AVG_ADVANCE_EM[style.fontFamily] ?? AVG_ADVANCE_EM['Inter']
  const perChar = fontSize * em * (style.bold ? 1.04 : 1)
  const maxChars = Math.max(1, Math.floor(width / perChar))

  // Wrap on words, as the renderer does. Breaking at a hard character count
  // made the longest line look wider than it renders, which is what put the
  // marksheet's "Result" label into a phantom collision with its own value.
  const lines = []
  for (const segment of resolve(el.content, values).split('\n')) {
    if (segment.length === 0) {
      lines.push(0)
      continue
    }
    let current = 0
    for (const word of segment.split(/\s+/)) {
      const wordLen = word.length
      if (current === 0) {
        current = wordLen
      } else if (current + 1 + wordLen <= maxChars) {
        current += 1 + wordLen
      } else {
        lines.push(current)
        current = wordLen
      }
      // A single word longer than the line breaks mid-word, as the renderer does.
      while (current > maxChars) {
        lines.push(maxChars)
        current -= maxChars
      }
    }
    lines.push(current)
  }

  const lineBox = fontSize * lineHeight
  const inkH = fontSize * INK_BAND_EM
  const leadingAbove = (lineBox - inkH) / 2
  const align = style.align ?? 'left'
  return lines.map((chars, i) => {
    const w = Math.min(width, chars * perChar)
    let x = el.x
    if (align === 'right') x = el.x + width - w
    else if (align === 'center') x = el.x + (width - w) / 2
    return { x, y: el.y + i * lineBox + leadingAbove, w, h: inkH, line: i }
  })
}

function intersect(a, b) {
  const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return dx > MIN_OVERLAP_PT && dy > MIN_OVERLAP_PT ? { dx, dy } : null
}

/**
 * Collisions between the rendered text of `elements`, given the preview values
 * they will be filled with. Returns one entry per colliding pair of lines.
 */
export function findCollisions(elements, values) {
  const els = (elements ?? []).filter(
    (e) => TEXT_LIKE.has(e.type ?? 'TEXT') && (e.height ?? 0) > 0
  )
  const withRects = els.map((e) => ({ el: e, rects: inkRects(e, values) }))
  const hits = []
  for (let i = 0; i < withRects.length; i++) {
    for (let j = i + 1; j < withRects.length; j++) {
      for (const ra of withRects[i].rects) {
        for (const rb of withRects[j].rects) {
          const hit = intersect(ra, rb)
          if (hit) {
            hits.push(
              `${withRects[i].el.id}:L${ra.line} × ${withRects[j].el.id}:L${rb.line}` +
                ` (${hit.dx.toFixed(1)}×${hit.dy.toFixed(1)}pt)`
            )
          }
        }
      }
    }
  }
  return hits
}

// ── CLI: re-check the bundles already on disk ────────────────────────────────

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let total = 0
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()

  for (const file of files) {
    const bundle = JSON.parse(readFileSync(join(DIR, file), 'utf8'))
    const values = bundle.variableValues ?? {}
    const hits = (bundle.layout.pages ?? []).flatMap((page) =>
      findCollisions(page.elements, values)
    )
    if (hits.length) {
      total += hits.length
      console.log(`✗ ${file.replace(/\.json$/, '')}`)
      for (const h of hits.slice(0, 6)) console.log(`    ${h}`)
      if (hits.length > 6) console.log(`    … ${hits.length - 6} more`)
    }
  }

  console.log(
    total === 0
      ? `\n✓ ${files.length} templates: no text collides with other text`
      : `\n${total} candidate collision(s) across ${files.length} templates`
  )
  process.exit(total === 0 ? 0 : 1)
}
