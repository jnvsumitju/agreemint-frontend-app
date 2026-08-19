#!/usr/bin/env node
/**
 * Generates the 20 prebuilt template bundles in `src/try-templates/`.
 *
 * Run: `node scripts/generate-try-templates.mjs`
 *
 * Output is exactly the shape `exportTemplateJson` emits, so a bundle can be
 * opened in the editor, edited, and re-exported without any conversion. The
 * generator is the source of truth rather than the JSON: twenty documents share
 * six layout archetypes, and hand-maintaining twenty near-identical files would
 * guarantee they drift apart.
 *
 * ── Renderer constraints these layouts must respect ──────────────────────────
 *
 *  1. Page size: only A4 / LETTER / A3 / A5 are honoured by PdfRendererService
 *     (`:2808-2813`). Anything else silently becomes A4.
 *  2. Orientation is never read — there are zero references to it in the
 *     backend `pdf/` package. Everything is portrait, which is why the ID card
 *     and admit card are laid out as card faces on a portrait sheet with cut
 *     guides rather than as landscape pages.
 *  3. Variables match `\{\{\s*([a-zA-Z0-9_.]+)\s*}}` (`PdfRendererService:74`).
 *     No pipes, no filters, no expressions: `{{total | currency}}` renders
 *     literally, pipe included. Every value must therefore arrive already
 *     formatted as a string.
 *  4. Table bodies come from an array of objects under the element's `dataKey`,
 *     with each column mapped by `columns[].key`.
 */

import { mkdirSync, writeFileSync, readdirSync, unlinkSync, existsSync } from 'node:fs'
import { findCollisions } from './check-template-collisions.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'try-templates')

/**
 * Second output: the backend's classpath, so the same twenty bundles can be
 * seeded as first-party marketplace listings.
 *
 * <p>Generated rather than copied by hand, and generated from this one script,
 * because the alternative is the same layout maintained in two repositories —
 * and the failure mode there is silent: the marketplace would keep serving a
 * template the sandbox had already fixed, and nothing would flag the drift.
 *
 * <p>Skipped without complaint when the backend repo is not checked out
 * alongside this one, so the console can still be built on its own. Override
 * with SEED_OUT_DIR.
 */
const SEED_OUT_DIR =
  process.env.SEED_OUT_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), '..', '..',
       'agreemint-backend-app', 'src', 'main', 'resources', 'seed-templates')

/**
 * Fixed so re-running the generator produces no diff. A real timestamp would
 * rewrite all twenty files on every run and bury actual layout changes.
 */
const EXPORTED_AT = '2026-08-16T00:00:00.000Z'

// ── Page geometry (A4 portrait, in points) ───────────────────────────────────
const PAGE_W = 595
const PAGE_H = 842
const M = 44
const CW = PAGE_W - M * 2 // 507pt of content width
const RIGHT = PAGE_W - M

// ── Palette ──────────────────────────────────────────────────────────────────
const INK = '#111827'
const BODY = '#374151'
const MUTED = '#6b7280'
const RULE = '#e5e7eb'
const SOFT = '#f8fafc'

const ACCENT = {
  Finance: '#4338ca',
  HR: '#0f766e',
  Education: '#a16207',
  Business: '#1d4ed8',
  Legal: '#7c3aed',
}

/**
 * The categories a template may declare.
 *
 * <p>Derived from ACCENT so the two cannot drift: a category with no accent
 * colour would render with a silent fallback, and an accent with no category
 * would be dead config.
 *
 * <p>This list is the SOURCE of the category, not a copy of it. The value is
 * written into each bundle and read from there by the backend seeder and by the
 * console's catalogue test. It used to be inferred from the slug by a keyword
 * chain in the backend that fell through to "Business", so a template whose
 * name matched no keyword was silently mis-filed with nothing to catch it.
 */
const CATEGORIES = Object.keys(ACCENT)

const SANS = 'Inter'
const SERIF = 'Source Serif 4'
const MONO = 'JetBrains Mono'

// ── Element factories ────────────────────────────────────────────────────────

let seq = 0
const id = (p) => `${p}${String(++seq).padStart(3, '0')}`

/**
 * Preview values for the template currently being built.
 *
 * <p>Module-level because box heights depend on the *resolved* text — a box has
 * to fit `"Meridian Institute of Technology"`, not `"{{institution.name}}"` —
 * and threading the values through every builder signature would touch all 20.
 * Set once per template in the generation loop, immediately before `build()`.
 */
let activeValues = {}

/**
 * Average glyph advance as a fraction of the em, per shipped family.
 *
 * <p>JetBrains Mono is exact — it is monospaced at 0.6em. The proportional
 * numbers are deliberately generous: over-estimating predicts an extra line and
 * yields a box slightly taller than needed, which is harmless, whereas
 * under-estimating clips glyphs. Validated against the real iText measurement
 * rather than trusted on their own.
 */
const AVG_ADVANCE_EM = { [SANS]: 0.56, [SERIF]: 0.54, [MONO]: 0.6 }

/** `invoice.place_of_supply` → `Invoice Place Of Supply`, as the editor shows it. */
function humanisePlaceholder(key) {
  return key
    .split(/[._]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Height the content will actually occupy once wrapped, in pt.
 *
 * <p>`mode: 'placeholder'` substitutes the field-name label the editor shows
 * before any data is entered, which is routinely LONGER than the data itself —
 * "Invoice Place Of Supply" against "Karnataka (29)".
 */
function fittedHeight(content, width, style, mode = 'value') {
  const fontSize = style.fontSize ?? 10
  const lineHeight = style.lineHeight ?? 1.45
  if (!(width > 0) || typeof content !== 'string') return fontSize * lineHeight

  const resolved = content.replace(
    /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,
    (m, k) => (mode === 'placeholder' ? humanisePlaceholder(k) : activeValues[k] ?? m)
  )
  const em = AVG_ADVANCE_EM[style.fontFamily] ?? AVG_ADVANCE_EM[SANS]
  // Bold sets slightly wider; a few percent is enough to matter at a wrap.
  const perChar = fontSize * em * (style.bold ? 1.04 : 1)
  const maxChars = Math.max(1, Math.floor(width / perChar))

  // Explicit newlines are hard breaks; each segment then wraps on its own.
  // A blank segment (from "\n\n") is still one empty line.
  let lines = 0
  for (const segment of resolved.split('\n')) {
    lines += Math.max(1, Math.ceil(segment.length / maxChars))
  }
  return Math.ceil(lines * fontSize * lineHeight * 100) / 100
}

function text(x, y, width, height, content, style = {}) {
  const merged = { fontSize: 10, fontFamily: SANS, color: BODY, lineHeight: 1.45, ...style }
  // A box can never be shorter than the text it holds. The heights below are
  // hand-written per call site, and 68 of them had drifted under even a single
  // line. Both surfaces clip a too-short box — the canvas silently, the PDF
  // visibly mid-glyph — so an offer letter shipped reading "...by 26 August
  // 2026. We look" with the rest of the sentence and the sign-off gone.
  //
  // Only ever grows, so every deliberately-tall box stays exactly as authored.
  // Callers that stack content below a growable block must advance by the
  // RETURNED element's height rather than the one they passed in.
  // The box is sized for whichever is taller: the preview value, or the
  // field-name placeholder the editor shows before anyone types. Sizing for the
  // value alone let the placeholder be CLIPPED rather than wrapped, and a
  // truncated "Totals Grand Total" reads as the value "Totals Grand" — a
  // silent lie is worse than an obviously-too-long line.
  //
  // Extra height costs nothing once real data is in: text is top-anchored, so
  // an oversized box draws no ink. Callers stacking content below must advance
  // by `contentHeight()`, NOT by this box height, or every layout would space
  // itself out to fit placeholders no finished document contains.
  const el = {
    id: id('t'),
    type: 'TEXT',
    x,
    y,
    width,
    height: Math.max(
      height,
      fittedHeight(content, width, merged, 'value'),
      fittedHeight(content, width, merged, 'placeholder')
    ),
    content,
    style: merged,
  }
  el.contentHeight = Math.max(height, fittedHeight(content, width, merged, 'value'))
  return el
}

/** What the element occupies with real data — the number layout math must use. */
function contentHeight(el) {
  return el.contentHeight ?? el.height
}

/**
 * Small uppercase field label — the "BILL TO" / "INVOICE NO" style.
 *
 * <p>Uppercases the surrounding words but leaves `{{placeholders}}` alone.
 * Variable names are case-sensitive, so folding one to `{{JOB.DOCS_DUE}}` would
 * silently stop it resolving and print the raw braces in the finished document.
 */
function label(x, y, width, content, color = MUTED) {
  const shouted = content
    .split(/(\{\{\s*[a-zA-Z0-9_.]+\s*}})/g)
    .map((part) => (part.startsWith('{{') ? part : part.toUpperCase()))
    .join('')
  return text(x, y, width, 12, shouted, {
    fontSize: 7.5,
    bold: true,
    color,
  })
}

function rect(x, y, width, height, style = {}) {
  return { id: id('r'), type: 'POLYGON', polygonKind: 'rect', x, y, width, height, style }
}

function rule(x, y, width, color = RULE, strokeWidth = 1) {
  return {
    id: id('l'),
    type: 'LINE',
    x,
    y,
    width,
    height: 0,
    strokeWidth,
    style: { color },
  }
}

function table(x, y, width, height, columns, dataKey, opts = {}) {
  return {
    id: id('tb'),
    type: 'TABLE',
    x,
    y,
    width,
    height,
    columns,
    columnWidths: opts.columnWidths ?? columns.map(() => 1),
    dataKey,
    tablePreviewBodyRows: opts.rows ?? 4,
    tableRowBackgrounds: { '-1': opts.headerBg ?? SOFT },
    style: { fontSize: 9, fontFamily: SANS, color: BODY, ...(opts.style ?? {}) },
  }
}

function list(x, y, width, height, items, opts = {}) {
  return {
    id: id('li'),
    type: 'LIST',
    x,
    y,
    width,
    height,
    listStyle: opts.listStyle ?? 'number',
    listItems: items.map((t) => ({ text: t })),
    listItemSpacing: opts.spacing ?? 7,
    listIndent: opts.indent ?? 20,
    style: { fontSize: 9.5, fontFamily: SANS, color: BODY, lineHeight: 1.5, ...(opts.style ?? {}) },
  }
}

// ── Composite blocks ─────────────────────────────────────────────────────────

/**
 * Company identity top-left, document title top-right.
 * Returns the y coordinate the next block should start at.
 */
function letterhead(els, accent, title, metaRows, opts = {}) {
  const prefix = opts.varPrefix ?? 'company'
  els.push(rect(M, M, 3, 34, { backgroundColor: accent }))
  // A long identity ("Meridian Institute of Technology") wraps to two lines at
  // 16pt in the space left by the title, so everything below it has to follow
  // the box's real height rather than a fixed 20pt step.
  const nameEl = text(M + 12, M, 250, 20, `{{${prefix}.name}}`, {
    fontSize: 16,
    bold: true,
    color: INK,
  })
  els.push(nameEl)
  // 46pt, not 30: this block is three lines (two of address, one of contact) at
  // 8.5pt on a 1.4 line-height, so it needs ~36pt — and the address is the
  // field a user is most likely to make longer, not shorter. A box sized to the
  // sample data clips the moment anyone edits it, silently, with no warning on
  // the canvas.
  els.push(
    text(M + 12, M + contentHeight(nameEl), 270, 46, `{{${prefix}.address}}\n{{${prefix}.contact}}`, {
      fontSize: 8.5,
      color: MUTED,
      lineHeight: 1.4,
    })
  )

  els.push(
    text(RIGHT - 230, M - 2, 230, 26, title, {
      fontSize: 22,
      bold: true,
      color: accent,
      align: 'right',
      fontFamily: SANS,
    })
  )

  let y = M + 28
  for (const [k, v] of metaRows) {
    // Column split: 82pt label / 146pt value, not 110/116.
    //
    // A freshly imported template is read with FIELD-NAME placeholders before
    // anyone types real data, and those are longer than the data. "Invoice
    // Place Of Supply" needs 117.3pt of mono at 8.5pt; the old 116pt box wrapped
    // it and the PDF clipped the second line, so the invoice showed "Invoice
    // Place Of" — truncated to something that still reads like a real value,
    // which is the worst way for it to fail. The labels never needed 110pt: the
    // longest ("Place of supply") is 63.8pt.
    const labelEl = text(RIGHT - 230, y, 82, 12, k, {
      fontSize: 8.5,
      color: MUTED,
      align: 'right',
    })
    const valueEl = text(RIGHT - 146, y, 146, 12, v, {
      fontSize: 8.5,
      color: INK,
      align: 'right',
      fontFamily: MONO,
    })
    els.push(labelEl, valueEl)
    // 1pt gap, as the original fixed 13pt step gave a 12pt box. A value that
    // wraps (mono is wide: 116pt holds only ~22 characters at 8.5pt) pushes the
    // following row down instead of being overprinted by it.
    y += Math.max(contentHeight(labelEl), contentHeight(valueEl)) + 1
  }

  const identityBottom = M + contentHeight(nameEl) + 46
  const bottom = Math.max(y, identityBottom, M + 62) + 10
  els.push(rule(M, bottom, CW))
  return bottom + 18
}

/** A labelled block of address-ish lines. */
function party(els, x, y, width, heading, lines, accent) {
  els.push(label(x, y, width, heading, accent))
  els.push(
    text(x, y + 13, width, 16, lines[0], { fontSize: 11, bold: true, color: INK })
  )
  if (lines.length > 1) {
    els.push(
      text(x, y + 30, width, 46, lines.slice(1).join('\n'), {
        fontSize: 9,
        color: MUTED,
        lineHeight: 1.5,
      })
    )
  }
  return y + 84
}

/** Right-aligned label/value rows, used for totals. */
function totals(els, x, y, width, rows, accent) {
  const labelW = width * 0.58
  const valueW = width - labelW
  let cy = y
  for (const row of rows) {
    const strong = !!row.strong
    const labelEl = text(x + 8, cy, labelW, 14, row.label, {
      fontSize: strong ? 10 : 9,
      bold: strong,
      color: strong ? INK : MUTED,
      align: 'right',
    })
    const valueEl = text(x + labelW, cy, valueW - 8, 14, row.value, {
      fontSize: strong ? 11 : 9.5,
      bold: strong,
      color: strong ? accent : INK,
      align: 'right',
      fontFamily: MONO,
    })
    const rowH = Math.max(contentHeight(labelEl), contentHeight(valueEl))
    // The highlight has to grow with the row. A fixed 22pt band behind a value
    // that wrapped left the extra lines sitting outside their own background.
    if (strong) {
      els.push(rect(x, cy - 4, width, rowH + 8, { backgroundColor: SOFT, borderRadius: 3 }))
    }
    els.push(labelEl, valueEl)
    // Advance by what the row actually occupies. The fixed step overprinted the
    // next row whenever a value wrapped — mono in a narrow value column holds
    // very little, and these carry text as well as figures ("PASS — First Class
    // with Distinction").
    cy += rowH + (strong ? 12 : 2)
  }
  return cy
}

/** Signature rule with a name and a role beneath it. */
function signature(els, x, y, width, nameVar, roleText, align = 'left') {
  els.push(rule(x, y, width, '#9ca3af'))
  els.push(text(x, y + 6, width, 14, nameVar, { fontSize: 10, bold: true, color: INK, align }))
  els.push(text(x, y + 20, width, 24, roleText, { fontSize: 8.5, color: MUTED, align, lineHeight: 1.35 }))
  return y + 46
}

function footnote(els, content) {
  els.push(rule(M, PAGE_H - M - 30, CW))
  els.push(
    text(M, PAGE_H - M - 22, CW, 22, content, {
      fontSize: 7.5,
      color: MUTED,
      align: 'center',
      lineHeight: 1.4,
    })
  )
}

// ── Archetype 1: financial document ──────────────────────────────────────────

function financialDoc(cfg) {
  const els = []
  const accent = ACCENT.Finance
  let y = letterhead(els, accent, cfg.title, cfg.meta)

  y = Math.max(
    party(els, M, y, 230, cfg.partyHeading, cfg.partyLines, accent),
    cfg.secondParty
      ? party(els, M + 268, y, 239, cfg.secondParty.heading, cfg.secondParty.lines, accent)
      : 0
  )

  if (cfg.strip) {
    els.push(rect(M, y - 6, CW, 30, { backgroundColor: SOFT, borderRadius: 4 }))
    const colW = CW / cfg.strip.length
    cfg.strip.forEach((cell, i) => {
      els.push(label(M + 10 + colW * i, y + 1, colW - 12, cell[0]))
      els.push(
        text(M + 10 + colW * i, y + 11, colW - 12, 12, cell[1], {
          fontSize: 9,
          bold: true,
          color: INK,
        })
      )
    })
    y += 42
  }

  els.push(table(M, y, CW, cfg.tableHeight ?? 118, cfg.columns, cfg.dataKey, {
    rows: cfg.rows ?? 4,
    columnWidths: cfg.columnWidths,
  }))
  y += (cfg.tableHeight ?? 118) + 18

  if (cfg.totals) {
    const w = 250
    const endY = totals(els, RIGHT - w, y, w, cfg.totals, accent)
    if (cfg.amountInWords) {
      els.push(label(M, y, 240, 'Amount in words'))
      els.push(
        text(M, y + 12, 240, 40, cfg.amountInWords, {
          fontSize: 9,
          italic: true,
          color: BODY,
          lineHeight: 1.45,
        })
      )
    }
    y = Math.max(endY, y + 56) + 16
  }

  if (cfg.notes) {
    els.push(label(M, y, 250, cfg.notes.heading))
    els.push(
      text(M, y + 13, 250, 58, cfg.notes.body, { fontSize: 8.5, color: MUTED, lineHeight: 1.5 })
    )
  }

  // 240 wide: the role line carries a company name ('Authorised signatory,
  // <company>') and clipped at 190.
  signature(els, RIGHT - 240, y + 34, 240, cfg.signName, cfg.signRole, 'right')
  footnote(els, cfg.footer)
  return els
}

// ── Archetype 2: formal letter ───────────────────────────────────────────────

function formalLetter(cfg) {
  const els = []
  const accent = ACCENT.HR
  let y = letterhead(els, accent, cfg.title, cfg.meta)

  els.push(
    text(M, y, CW, 14, '{{letter.date}}', { fontSize: 9.5, color: MUTED })
  )
  y += 24

  els.push(
    text(M, y, CW, 16, '{{recipient.name}}', { fontSize: 11.5, bold: true, color: INK })
  )
  els.push(
    text(M, y + 17, CW, 34, '{{recipient.address}}', {
      fontSize: 9,
      color: MUTED,
      lineHeight: 1.5,
    })
  )
  y += 60

  els.push(
    text(M, y, CW, 16, cfg.subject, { fontSize: 10.5, bold: true, color: INK })
  )
  y += 24

  els.push(text(M, y, CW, 16, cfg.salutation, { fontSize: 10, color: BODY }))
  y += 22

  for (const para of cfg.paragraphs) {
    const h = para.height ?? 52
    els.push(
      text(M, y, CW, h, para.body ?? para, {
        fontSize: 10,
        color: BODY,
        lineHeight: 1.6,
        fontFamily: SERIF,
      })
    )
    y += h + 12
  }

  if (cfg.terms) {
    els.push(label(M, y, CW, cfg.terms.heading, accent))
    y += 15
    const h = 22 * cfg.terms.items.length
    els.push(list(M + 4, y, CW - 8, h, cfg.terms.items, { listStyle: 'disc' }))
    y += h + 16
  }

  // The closing can be several lines (many templates end with a paragraph, a
  // blank line, then the sign-off), so the signature has to follow the box's
  // real height. Pinning it to `y + 46` overlapped the sign-off the moment the
  // closing grew past one line.
  const closing = text(M, y, CW, 16, cfg.closing ?? 'Yours sincerely,', {
    fontSize: 10,
    color: BODY,
  })
  els.push(closing)
  signature(els, M, y + contentHeight(closing) + 18, 200, '{{signatory.name}}', '{{signatory.title}}')

  footnote(els, cfg.footer)
  return els
}

// ── Archetype 3: certificate ─────────────────────────────────────────────────

function certificate(cfg) {
  const els = []
  const accent = ACCENT.Education

  els.push(rect(24, 24, PAGE_W - 48, PAGE_H - 48, { borderWidth: 3, color: accent, borderRadius: 6 }))
  els.push(rect(34, 34, PAGE_W - 68, PAGE_H - 68, { borderWidth: 0.75, color: '#d4b483', borderRadius: 4 }))

  let y = 118
  els.push(
    text(M + 20, y, CW - 40, 22, '{{institution.name}}', {
      fontSize: 13,
      bold: true,
      color: INK,
      align: 'center',
      fontFamily: SANS,
    })
  )
  y += 22
  els.push(
    text(M + 20, y, CW - 40, 14, '{{institution.tagline}}', {
      fontSize: 8.5,
      color: MUTED,
      align: 'center',
    })
  )
  y += 46

  els.push(
    text(M + 20, y, CW - 40, 40, cfg.heading, {
      fontSize: 30,
      bold: true,
      color: accent,
      align: 'center',
      fontFamily: SERIF,
    })
  )
  y += 48
  els.push(
    text(M + 20, y, CW - 40, 16, cfg.subheading, {
      fontSize: 10,
      color: MUTED,
      align: 'center',
      lineHeight: 1.4,
    })
  )
  y += 44

  els.push(
    text(M + 20, y, CW - 40, 40, '{{recipient.name}}', {
      fontSize: 26,
      bold: true,
      color: INK,
      align: 'center',
      fontFamily: SERIF,
    })
  )
  y += 42
  els.push(rule(PAGE_W / 2 - 130, y, 260, '#d4b483'))
  y += 26

  els.push(
    text(M + 40, y, CW - 80, 74, cfg.body, {
      fontSize: 11,
      color: BODY,
      align: 'center',
      lineHeight: 1.7,
      fontFamily: SERIF,
    })
  )
  y += 96

  if (cfg.detailStrip) {
    els.push(rect(M + 60, y, CW - 120, 40, { backgroundColor: SOFT, borderRadius: 4 }))
    const colW = (CW - 120) / cfg.detailStrip.length
    cfg.detailStrip.forEach((cell, i) => {
      const cx = M + 60 + colW * i
      els.push(
        text(cx, y + 7, colW, 11, cell[0].toUpperCase(), {
          fontSize: 7,
          bold: true,
          color: MUTED,
          align: 'center',
        })
      )
      els.push(
        text(cx, y + 20, colW, 13, cell[1], {
          fontSize: 9.5,
          bold: true,
          color: INK,
          align: 'center',
        })
      )
    })
    y += 62
  }

  const sigY = PAGE_H - 168
  signature(els, M + 40, sigY, 170, '{{signatory.name}}', '{{signatory.title}}', 'center')
  signature(els, RIGHT - 210, sigY, 170, '{{cosignatory.name}}', '{{cosignatory.title}}', 'center')

  els.push(
    text(M, PAGE_H - 92, CW, 14, 'Certificate no. {{certificate.number}}', {
      fontSize: 8,
      color: MUTED,
      align: 'center',
      fontFamily: MONO,
    })
  )
  return els
}

// ── Archetype 4: card sheet (portrait A4 with cut guides) ────────────────────

/**
 * Two card faces on a portrait sheet.
 *
 * <p>ID cards and admit cards are conventionally landscape, and the renderer
 * has no landscape support at all. Rather than ship something that silently
 * renders portrait anyway, these are laid out the way an office actually
 * produces them: card-sized artwork on an A4 sheet, with crop marks, ready to
 * cut. It prints correctly from any printer with no page setup.
 */
function cardSheet(cfg) {
  const els = []
  const accent = cfg.accent ?? ACCENT.Education
  const cardW = 340
  const cardH = 214
  const cx = (PAGE_W - cardW) / 2

  els.push(
    text(M, M, CW, 16, cfg.sheetTitle, { fontSize: 11, bold: true, color: INK })
  )
  els.push(
    text(M, M + 17, CW, 24, 'Print at 100% scale (no "fit to page") and cut along the guides.', {
      fontSize: 8,
      color: MUTED,
    })
  )

  cfg.faces.forEach((face, index) => {
    const top = 130 + index * (cardH + 74)

    // Crop marks, 10pt outside each corner.
    for (const [mx, my, dx, dy] of [
      [cx, top, -1, -1],
      [cx + cardW, top, 1, -1],
      [cx, top + cardH, -1, 1],
      [cx + cardW, top + cardH, 1, 1],
    ]) {
      els.push(rule(mx + (dx < 0 ? -12 : 0), my, 12, '#cbd5e1', 0.5))
      els.push({
        id: id('l'),
        type: 'LINE',
        x: mx,
        y: my + (dy < 0 ? -12 : 0),
        width: 0,
        height: 12,
        strokeWidth: 0.5,
        style: { color: '#cbd5e1', rotation: 90 },
      })
    }

    els.push(
      rect(cx, top, cardW, cardH, {
        backgroundColor: '#ffffff',
        borderWidth: 1,
        color: '#cbd5e1',
        borderRadius: 10,
      })
    )
    els.push(rect(cx, top, cardW, 46, { backgroundColor: accent, borderRadius: 10 }))
    els.push(
      text(cx + 14, top + 10, cardW - 28, 14, '{{institution.name}}', {
        fontSize: 11,
        bold: true,
        color: '#ffffff',
      })
    )
    els.push(
      text(cx + 14, top + 26, cardW - 28, 12, face.strapline, {
        fontSize: 7.5,
        color: '#e0e7ff',
      })
    )

    if (face.photo) {
      els.push(
        rect(cx + 16, top + 62, 78, 96, {
          backgroundColor: SOFT,
          borderWidth: 1,
          color: RULE,
          borderRadius: 4,
        })
      )
      els.push(
        text(cx + 16, top + 103, 78, 14, 'PHOTO', {
          fontSize: 7.5,
          color: '#9ca3af',
          align: 'center',
          bold: true,
        })
      )
    }

    const fx = face.photo ? cx + 106 : cx + 16
    const fw = cardW - (face.photo ? 122 : 32)
    let fy = top + 62
    els.push(
      text(fx, fy, fw, 18, face.nameVar, { fontSize: 13, bold: true, color: INK })
    )
    fy += 22
    for (const [k, v] of face.fields) {
      els.push(text(fx, fy, 74, 12, k, { fontSize: 7.5, bold: true, color: MUTED }))
      els.push(text(fx + 76, fy, fw - 76, 12, v, { fontSize: 8.5, color: INK }))
      fy += 14
    }

    els.push(rule(cx + 16, top + cardH - 30, cardW - 32, RULE))
    els.push(
      text(cx + 16, top + cardH - 24, cardW - 32, 14, face.footer, {
        fontSize: 7.5,
        color: MUTED,
      })
    )
  })

  return els
}

// ── Archetype 5: tabular record (salary slip, marksheet) ─────────────────────

function tabularRecord(cfg) {
  const els = []
  const accent = cfg.accent ?? ACCENT.Finance
  let y = letterhead(els, accent, cfg.title, cfg.meta, { varPrefix: cfg.varPrefix ?? 'company' })

  els.push(rect(M, y, CW, 74, { backgroundColor: SOFT, borderRadius: 5 }))
  const cols = 3
  const colW = (CW - 28) / cols
  cfg.details.forEach((cell, i) => {
    const row = Math.floor(i / cols)
    const col = i % cols
    const dx = M + 14 + colW * col
    const dy = y + 12 + row * 30
    els.push(label(dx, dy, colW - 10, cell[0]))
    els.push(
      text(dx, dy + 11, colW - 10, 14, cell[1], { fontSize: 9.5, bold: true, color: INK })
    )
  })
  y += 92

  for (const section of cfg.sections) {
    els.push(label(M, y, CW, section.heading, accent))
    y += 15
    const h = section.height ?? 104
    els.push(
      table(M, y, CW, h, section.columns, section.dataKey, {
        rows: section.rows ?? 4,
        columnWidths: section.columnWidths,
      })
    )
    y += h + 20
  }

  if (cfg.totals) {
    const w = 260
    y = totals(els, RIGHT - w, y, w, cfg.totals, accent) + 10
  }
  if (cfg.amountInWords) {
    els.push(label(M, y - 48, 230, 'In words'))
    els.push(
      text(M, y - 36, 230, 40, cfg.amountInWords, {
        fontSize: 9,
        italic: true,
        color: BODY,
        lineHeight: 1.45,
      })
    )
  }

  signature(els, RIGHT - 240, PAGE_H - 150, 240, '{{signatory.name}}', '{{signatory.title}}', 'right')
  footnote(els, cfg.footer)
  return els
}

// ── Archetype 6: long-form document (contract, NDA, proposal, report) ────────

function longFormDoc(cfg) {
  const els = []
  const accent = cfg.accent ?? ACCENT.Business

  els.push(rect(M, M, CW, 4, { backgroundColor: accent }))
  els.push(
    text(M, M + 18, CW, 30, cfg.title, { fontSize: 24, bold: true, color: INK })
  )
  els.push(
    text(M, M + 50, CW, 16, cfg.subtitle, { fontSize: 10, color: MUTED })
  )

  let y = M + 84
  els.push(rect(M, y, CW, 56, { backgroundColor: SOFT, borderRadius: 5 }))
  const colW = (CW - 28) / cfg.meta.length
  cfg.meta.forEach((cell, i) => {
    const dx = M + 14 + colW * i
    els.push(label(dx, y + 12, colW - 10, cell[0]))
    els.push(
      text(dx, y + 24, colW - 10, 16, cell[1], { fontSize: 9.5, bold: true, color: INK })
    )
  })
  y += 76

  if (cfg.parties) {
    y = Math.max(
      party(els, M, y, 235, cfg.parties[0].heading, cfg.parties[0].lines, accent),
      party(els, M + 272, y, 235, cfg.parties[1].heading, cfg.parties[1].lines, accent)
    )
    y += 4
  }

  if (cfg.intro) {
    els.push(
      text(M, y, CW, 46, cfg.intro, {
        fontSize: 10,
        color: BODY,
        lineHeight: 1.6,
        fontFamily: SERIF,
      })
    )
    y += 58
  }

  for (const section of cfg.sections) {
    els.push(
      text(M, y, CW, 16, section.heading, { fontSize: 11, bold: true, color: accent })
    )
    y += 20
    if (section.body) {
      const h = section.height ?? 52
      els.push(
        text(M, y, CW, h, section.body, {
          fontSize: 9.5,
          color: BODY,
          lineHeight: 1.6,
          fontFamily: SERIF,
        })
      )
      y += h + 12
    }
    if (section.items) {
      const h = 21 * section.items.length
      els.push(list(M + 6, y, CW - 12, h, section.items, { listStyle: section.listStyle ?? 'disc' }))
      y += h + 14
    }
    if (section.table) {
      const h = section.table.height ?? 96
      els.push(
        table(M, y, CW, h, section.table.columns, section.table.dataKey, {
          rows: section.table.rows ?? 3,
          columnWidths: section.table.columnWidths,
        })
      )
      y += h + 16
    }
  }

  if (cfg.signatures !== false) {
    const sigY = PAGE_H - 150
    els.push(rule(M, sigY - 20, CW))
    signature(els, M, sigY, 210, '{{party_one.signatory}}', '{{party_one.name}}')
    signature(els, RIGHT - 210, sigY, 210, '{{party_two.signatory}}', '{{party_two.name}}', 'right')
  }

  footnote(els, cfg.footer)
  return els
}

// ── Shared sample data ───────────────────────────────────────────────────────

const COMPANY = {
  'company.name': 'Northwind Traders Pvt Ltd',
  'company.address': '4th Floor, Prestige Corner, MG Road\nBengaluru, Karnataka 560001',
  'company.contact': 'accounts@northwind.example  ·  +91 80 4123 7788',
}

const CUSTOMER = [
  '{{customer.name}}',
  '{{customer.address}}',
  'GSTIN {{customer.gstin}}',
]

const CUSTOMER_VALUES = {
  'customer.name': 'Halcyon Design Studio',
  'customer.address': '22 Residency Road, Bengaluru 560025',
  'customer.gstin': '29AACCH1234R1Z8',
}

const rows = (arr) => JSON.stringify(arr)

// ── The templates ────────────────────────────────────────────────────────────

const TEMPLATES = [
  // ── Finance ────────────────────────────────────────────────────────────────
  {
    slug: 'free-invoice-template',
    category: 'Finance',
    name: 'Invoice',
    build: () =>
      financialDoc({
        title: 'INVOICE',
        meta: [
          ['Invoice no.', '{{invoice.number}}'],
          ['Issue date', '{{invoice.date}}'],
          ['Due date', '{{invoice.due_date}}'],
        ],
        partyHeading: 'Bill to',
        partyLines: CUSTOMER.slice(0, 2),
        secondParty: {
          heading: 'Ship to',
          lines: ['{{shipping.name}}', '{{shipping.address}}'],
        },
        columns: [
          { header: 'Description', key: 'description' },
          { header: 'Qty', key: 'qty' },
          { header: 'Rate', key: 'rate' },
          { header: 'Amount', key: 'amount' },
        ],
        columnWidths: [3.2, 0.7, 1, 1.1],
        dataKey: 'line_items',
        rows: 4,
        totals: [
          { label: 'Subtotal', value: '{{totals.subtotal}}' },
          { label: 'Discount', value: '{{totals.discount}}' },
          { label: 'Tax', value: '{{totals.tax}}' },
          { label: 'Total due', value: '{{totals.grand_total}}', strong: true },
        ],
        amountInWords: '{{totals.in_words}}',
        notes: {
          heading: 'Payment details',
          body: '{{payment.instructions}}',
        },
        signName: '{{signatory.name}}',
        signRole: 'For {{company.name}}',
        footer: 'Thank you for your business. Queries about this invoice? Reply to {{company.contact}}',
      }),
    values: {
      ...COMPANY,
      ...CUSTOMER_VALUES,
      'invoice.number': 'INV-2026-0184',
      'invoice.date': '16 Aug 2026',
      'invoice.due_date': '30 Aug 2026',
      'shipping.name': 'Halcyon Design Studio',
      'shipping.address': 'Warehouse 3, Hosur Road, Bengaluru 560068',
      'totals.subtotal': '₹1,24,000.00',
      'totals.discount': '−₹4,000.00',
      'totals.tax': '₹21,600.00',
      'totals.grand_total': '₹1,41,600.00',
      'totals.in_words':
        'One lakh forty-one thousand six hundred rupees only',
      'payment.instructions':
        'Bank transfer to Northwind Traders Pvt Ltd\nA/c 5010 2233 8891 · IFSC HDFC0000512\nPlease quote the invoice number.',
      'signatory.name': 'Ananya Rao',
      line_items: rows([
        { description: 'Brand identity design — full system', qty: '1', rate: '₹68,000.00', amount: '₹68,000.00' },
        { description: 'Website UI design (12 screens)', qty: '12', rate: '₹3,500.00', amount: '₹42,000.00' },
        { description: 'Print collateral adaptation', qty: '4', rate: '₹2,500.00', amount: '₹10,000.00' },
        { description: 'Photography licence — 1 year', qty: '1', rate: '₹4,000.00', amount: '₹4,000.00' },
      ]),
    },
  },
  {
    slug: 'free-gst-invoice-template',
    category: 'Finance',
    name: 'GST Invoice',
    build: () =>
      financialDoc({
        title: 'TAX INVOICE',
        meta: [
          ['Invoice no.', '{{invoice.number}}'],
          ['Invoice date', '{{invoice.date}}'],
          ['Place of supply', '{{invoice.place_of_supply}}'],
        ],
        partyHeading: 'Billed to',
        partyLines: CUSTOMER,
        secondParty: {
          heading: 'Supplier',
          lines: ['{{company.name}}', '{{company.address}}', 'GSTIN {{company.gstin}}'],
        },
        strip: [
          ['Reverse charge', '{{invoice.reverse_charge}}'],
          ['Transport', '{{invoice.transport}}'],
          ['E-way bill', '{{invoice.eway_bill}}'],
        ],
        columns: [
          { header: 'Description', key: 'description' },
          { header: 'HSN/SAC', key: 'hsn' },
          { header: 'Qty', key: 'qty' },
          { header: 'Rate', key: 'rate' },
          { header: 'Taxable', key: 'taxable' },
          { header: 'GST', key: 'gst' },
          { header: 'Amount', key: 'amount' },
        ],
        columnWidths: [2.6, 0.9, 0.5, 0.9, 1, 0.7, 1],
        dataKey: 'line_items',
        rows: 4,
        totals: [
          { label: 'Taxable value', value: '{{totals.taxable}}' },
          { label: 'CGST', value: '{{totals.cgst}}' },
          { label: 'SGST', value: '{{totals.sgst}}' },
          { label: 'IGST', value: '{{totals.igst}}' },
          { label: 'Invoice total', value: '{{totals.grand_total}}', strong: true },
        ],
        amountInWords: '{{totals.in_words}}',
        notes: {
          heading: 'Declaration',
          body: '{{invoice.declaration}}',
        },
        signName: '{{signatory.name}}',
        signRole: 'Authorised signatory, {{company.name}}',
        footer:
          'This is a computer-generated tax invoice. Subject to {{company.jurisdiction}} jurisdiction.',
      }),
    values: {
      ...COMPANY,
      ...CUSTOMER_VALUES,
      'company.gstin': '29AABCN2233K1ZP',
      'company.jurisdiction': 'Bengaluru',
      'invoice.number': 'GST/2026-27/0411',
      'invoice.date': '16 Aug 2026',
      'invoice.place_of_supply': 'Karnataka (29)',
      'invoice.reverse_charge': 'No',
      'invoice.transport': 'Blue Dart · BD8841203',
      'invoice.eway_bill': '3319 4477 8120',
      'invoice.declaration':
        'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
      'totals.taxable': '₹1,20,000.00',
      'totals.cgst': '₹10,800.00',
      'totals.sgst': '₹10,800.00',
      'totals.igst': '₹0.00',
      'totals.grand_total': '₹1,41,600.00',
      'totals.in_words': 'One lakh forty-one thousand six hundred rupees only',
      'signatory.name': 'Ananya Rao',
      line_items: rows([
        { description: 'Steel shelving unit — 5 tier', hsn: '9403', qty: '10', rate: '₹6,000.00', taxable: '₹60,000.00', gst: '18%', amount: '₹70,800.00' },
        { description: 'Workbench 1800mm', hsn: '9403', qty: '4', rate: '₹9,000.00', taxable: '₹36,000.00', gst: '18%', amount: '₹42,480.00' },
        { description: 'Installation service', hsn: '9954', qty: '1', rate: '₹18,000.00', taxable: '₹18,000.00', gst: '18%', amount: '₹21,240.00' },
        { description: 'Freight and handling', hsn: '9965', qty: '1', rate: '₹6,000.00', taxable: '₹6,000.00', gst: '18%', amount: '₹7,080.00' },
      ]),
    },
  },
  {
    slug: 'free-receipt-template',
    category: 'Finance',
    name: 'Receipt',
    build: () =>
      financialDoc({
        title: 'RECEIPT',
        meta: [
          ['Receipt no.', '{{receipt.number}}'],
          ['Date', '{{receipt.date}}'],
          ['Against invoice', '{{receipt.invoice_number}}'],
        ],
        partyHeading: 'Received from',
        partyLines: CUSTOMER.slice(0, 2),
        strip: [
          ['Payment method', '{{payment.method}}'],
          ['Reference', '{{payment.reference}}'],
          ['Received on', '{{payment.date}}'],
        ],
        columns: [
          { header: 'Description', key: 'description' },
          { header: 'Period', key: 'period' },
          { header: 'Amount', key: 'amount' },
        ],
        columnWidths: [3, 1.4, 1.1],
        dataKey: 'line_items',
        rows: 3,
        tableHeight: 96,
        totals: [
          { label: 'Amount received', value: '{{totals.received}}', strong: true },
          { label: 'Balance outstanding', value: '{{totals.balance}}' },
        ],
        amountInWords: '{{totals.in_words}}',
        notes: {
          heading: 'Note',
          body: '{{receipt.note}}',
        },
        signName: '{{signatory.name}}',
        signRole: 'Received by, {{company.name}}',
        footer: 'This receipt confirms payment received and is valid without a physical signature.',
      }),
    values: {
      ...COMPANY,
      ...CUSTOMER_VALUES,
      'receipt.number': 'RCP-2026-0392',
      'receipt.date': '16 Aug 2026',
      'receipt.invoice_number': 'INV-2026-0184',
      'receipt.note': 'Payment applied in full against the referenced invoice. No balance carried forward.',
      'payment.method': 'NEFT',
      'payment.reference': 'HDFCN26081612447',
      'payment.date': '16 Aug 2026',
      'totals.received': '₹1,41,600.00',
      'totals.balance': '₹0.00',
      'totals.in_words': 'One lakh forty-one thousand six hundred rupees only',
      'signatory.name': 'Ananya Rao',
      line_items: rows([
        { description: 'Payment against invoice INV-2026-0184', period: 'Aug 2026', amount: '₹1,41,600.00' },
      ]),
    },
  },
  {
    slug: 'free-quotation-template',
    category: 'Finance',
    name: 'Quotation',
    build: () =>
      financialDoc({
        title: 'QUOTATION',
        meta: [
          ['Quote no.', '{{quote.number}}'],
          ['Date', '{{quote.date}}'],
          ['Valid until', '{{quote.valid_until}}'],
        ],
        partyHeading: 'Prepared for',
        partyLines: ['{{customer.name}}', '{{customer.address}}', 'Attn: {{customer.contact_person}}'],
        secondParty: {
          heading: 'Prepared by',
          lines: ['{{company.name}}', '{{company.address}}'],
        },
        columns: [
          { header: 'Item', key: 'description' },
          { header: 'Qty', key: 'qty' },
          { header: 'Unit price', key: 'rate' },
          { header: 'Amount', key: 'amount' },
        ],
        columnWidths: [3.2, 0.7, 1.1, 1.1],
        dataKey: 'line_items',
        rows: 5,
        tableHeight: 138,
        totals: [
          { label: 'Subtotal', value: '{{totals.subtotal}}' },
          { label: 'Tax', value: '{{totals.tax}}' },
          { label: 'Quoted total', value: '{{totals.grand_total}}', strong: true },
        ],
        notes: {
          heading: 'Terms',
          body: '{{quote.terms}}',
        },
        signName: '{{signatory.name}}',
        signRole: '{{signatory.title}}',
        footer: 'Prices are valid until {{quote.valid_until}} and are subject to the terms above.',
      }),
    values: {
      ...COMPANY,
      ...CUSTOMER_VALUES,
      'customer.contact_person': 'Meera Krishnan, Head of Operations',
      'quote.number': 'QT-2026-0077',
      'quote.date': '16 Aug 2026',
      'quote.valid_until': '15 Sep 2026',
      'quote.terms':
        '50% advance on acceptance, balance on delivery.\nDelivery within 4 weeks of confirmed order.\nPrices exclude on-site installation outside Bengaluru.',
      'totals.subtotal': '₹2,86,000.00',
      'totals.tax': '₹51,480.00',
      'totals.grand_total': '₹3,37,480.00',
      'signatory.name': 'Vikram Shetty',
      'signatory.title': 'Sales Lead, Northwind Traders',
      line_items: rows([
        { description: 'Modular workstation — 6 seat cluster', qty: '4', rate: '₹42,000.00', amount: '₹1,68,000.00' },
        { description: 'Ergonomic task chair', qty: '24', rate: '₹3,500.00', amount: '₹84,000.00' },
        { description: 'Cable management kit', qty: '4', rate: '₹2,500.00', amount: '₹10,000.00' },
        { description: 'Acoustic screen 1200mm', qty: '12', rate: '₹1,500.00', amount: '₹18,000.00' },
        { description: 'Delivery and assembly', qty: '1', rate: '₹6,000.00', amount: '₹6,000.00' },
      ]),
    },
  },
  {
    slug: 'free-purchase-order-template',
    category: 'Finance',
    name: 'Purchase Order',
    build: () =>
      financialDoc({
        title: 'PURCHASE ORDER',
        meta: [
          ['PO number', '{{po.number}}'],
          ['PO date', '{{po.date}}'],
          ['Required by', '{{po.required_by}}'],
        ],
        partyHeading: 'Vendor',
        partyLines: ['{{vendor.name}}', '{{vendor.address}}', 'GSTIN {{vendor.gstin}}'],
        secondParty: {
          heading: 'Deliver to',
          lines: ['{{delivery.name}}', '{{delivery.address}}'],
        },
        strip: [
          ['Payment terms', '{{po.payment_terms}}'],
          ['Delivery terms', '{{po.delivery_terms}}'],
          ['Buyer contact', '{{po.buyer}}'],
        ],
        columns: [
          { header: 'Item code', key: 'code' },
          { header: 'Description', key: 'description' },
          { header: 'Qty', key: 'qty' },
          { header: 'Unit price', key: 'rate' },
          { header: 'Amount', key: 'amount' },
        ],
        columnWidths: [1, 2.8, 0.6, 1, 1.1],
        dataKey: 'line_items',
        rows: 4,
        totals: [
          { label: 'Subtotal', value: '{{totals.subtotal}}' },
          { label: 'Tax', value: '{{totals.tax}}' },
          { label: 'Order total', value: '{{totals.grand_total}}', strong: true },
        ],
        notes: {
          heading: 'Conditions',
          body: '{{po.conditions}}',
        },
        signName: '{{signatory.name}}',
        signRole: '{{signatory.title}}',
        footer: 'Quote the PO number on all invoices, delivery notes and correspondence.',
      }),
    values: {
      ...COMPANY,
      'vendor.name': 'Sterling Components Pvt Ltd',
      'vendor.address': 'Plot 14, Peenya Industrial Area, Bengaluru 560058',
      'vendor.gstin': '29AAECS8891M1Z4',
      'delivery.name': 'Northwind Traders — Central Warehouse',
      'delivery.address': 'Survey 88, Hosur Road, Bengaluru 560068',
      'po.number': 'PO-2026-1140',
      'po.date': '16 Aug 2026',
      'po.required_by': '05 Sep 2026',
      'po.payment_terms': 'Net 30',
      'po.delivery_terms': 'FOR destination',
      'po.buyer': 'R. Subramanian',
      'po.conditions':
        'Goods must match the specification quoted.\nPartial delivery requires written approval.\nRejected material will be returned at vendor cost.',
      'totals.subtotal': '₹4,12,000.00',
      'totals.tax': '₹74,160.00',
      'totals.grand_total': '₹4,86,160.00',
      'signatory.name': 'R. Subramanian',
      'signatory.title': 'Procurement Manager',
      line_items: rows([
        { code: 'SC-4410', description: 'Precision bearing assembly 40mm', qty: '200', rate: '₹1,120.00', amount: '₹2,24,000.00' },
        { code: 'SC-2280', description: 'Drive belt, reinforced', qty: '120', rate: '₹850.00', amount: '₹1,02,000.00' },
        { code: 'SC-9013', description: 'Mounting bracket, powder coated', qty: '300', rate: '₹220.00', amount: '₹66,000.00' },
        { code: 'SC-7702', description: 'Fastener kit (M8, 50 pcs)', qty: '40', rate: '₹500.00', amount: '₹20,000.00' },
      ]),
    },
  },

  // ── HR ─────────────────────────────────────────────────────────────────────
  {
    slug: 'free-offer-letter-template',
    category: 'HR',
    name: 'Offer Letter',
    build: () =>
      formalLetter({
        title: 'OFFER',
        meta: [
          ['Reference', '{{letter.reference}}'],
          ['Date', '{{letter.date}}'],
        ],
        subject: 'Subject: Offer of employment — {{job.title}}',
        salutation: 'Dear {{recipient.first_name}},',
        paragraphs: [
          {
            body: 'We are delighted to offer you the position of {{job.title}} in the {{job.department}} team at {{company.name}}. This offer follows your discussions with our hiring panel, and we believe your experience will be a strong fit for the work ahead.',
            height: 58,
          },
          {
            body: 'Your employment will commence on {{job.start_date}}, reporting to {{job.reporting_to}} at our {{job.location}} office. Your annual cost to company will be {{job.ctc}}, structured as set out in the annexure accompanying this letter.',
            height: 58,
          },
        ],
        terms: {
          heading: 'Key terms',
          items: [
            'Probation: {{job.probation}} from your date of joining.',
            'Notice period: {{job.notice_period}} once confirmed.',
            'Leave: {{job.leave}} per calendar year, in addition to public holidays.',
            'This offer is subject to satisfactory background and reference checks.',
          ],
        },
        closing:
          'Please confirm your acceptance by signing and returning a copy of this letter by {{job.accept_by}}. We look forward to welcoming you.\n\nYours sincerely,',
        footer: '{{company.name}} · {{company.address}} · {{company.contact}}',
      }),
    values: {
      'company.name': 'Northwind Traders Pvt Ltd',
      'company.address': '4th Floor, Prestige Corner, MG Road, Bengaluru 560001',
      'company.contact': 'people@northwind.example · +91 80 4123 7788',
      'letter.reference': 'NW/HR/2026/0231',
      'letter.date': '16 August 2026',
      'recipient.name': 'Ms Priya Nair',
      'recipient.first_name': 'Priya',
      'recipient.address': '18 Lakeview Apartments, Indiranagar\nBengaluru, Karnataka 560038',
      'job.title': 'Senior Operations Analyst',
      'job.department': 'Supply Chain',
      'job.start_date': '15 September 2026',
      'job.reporting_to': 'the Head of Supply Chain',
      'job.location': 'Bengaluru',
      'job.ctc': '₹18,50,000 per annum',
      'job.probation': 'Six months',
      'job.notice_period': 'Two months',
      'job.leave': '24 days of paid leave',
      'job.accept_by': '26 August 2026',
      'signatory.name': 'Devika Menon',
      'signatory.title': 'Head of People, Northwind Traders Pvt Ltd',
    },
  },
  {
    slug: 'free-experience-certificate-template',
    category: 'HR',
    name: 'Experience Certificate',
    build: () =>
      formalLetter({
        title: 'CERTIFICATE',
        meta: [
          ['Reference', '{{letter.reference}}'],
          ['Date', '{{letter.date}}'],
        ],
        subject: 'To whomsoever it may concern',
        salutation: '',
        paragraphs: [
          {
            body: 'This is to certify that {{recipient.name}} was employed with {{company.name}} from {{employment.from}} to {{employment.to}}. At the time of leaving, {{recipient.pronoun_subject}} held the position of {{employment.designation}} in the {{employment.department}} department.',
            height: 62,
          },
          {
            // Phrased so the verb agrees whatever pronoun the author sets. The
            // subject pronoun is a variable defaulting to "they", so the
            // original "{{recipient.pronoun_subject}} was responsible" printed
            // "they was responsible" out of the box — on a document whose whole
            // purpose is to be handed to a future employer.
            body: 'During {{recipient.pronoun_possessive}} tenure, {{recipient.pronoun_subject}} held responsibility for {{employment.responsibilities}}. We found {{recipient.pronoun_object}} to be {{employment.conduct}}, and {{recipient.pronoun_possessive}} contribution to the team was valued.',
            height: 62,
          },
          {
            body: '{{recipient.pronoun_subject_capitalised}} left the organisation of {{recipient.pronoun_possessive}} own accord, and all dues were settled in full. We wish {{recipient.pronoun_object}} every success in {{recipient.pronoun_possessive}} future endeavours.',
            height: 48,
          },
        ],
        closing: 'For {{company.name}},',
        footer: 'This certificate is issued on request and does not constitute a reference for any specific role.',
      }),
    values: {
      'company.name': 'Northwind Traders Pvt Ltd',
      'company.address': '4th Floor, Prestige Corner, MG Road, Bengaluru 560001',
      'company.contact': 'people@northwind.example · +91 80 4123 7788',
      'letter.reference': 'NW/HR/EXP/2026/0088',
      'letter.date': '16 August 2026',
      'recipient.name': 'Mr Arjun Desai',
      'recipient.address': '7 Brookefield Road, Bengaluru 560037',
      'recipient.pronoun_subject': 'they',
      'recipient.pronoun_subject_capitalised': 'They',
      'recipient.pronoun_object': 'them',
      'recipient.pronoun_possessive': 'their',
      'employment.from': '04 July 2022',
      'employment.to': '31 July 2026',
      'employment.designation': 'Logistics Coordinator',
      'employment.department': 'Supply Chain',
      'employment.responsibilities':
        'inbound freight scheduling, vendor coordination and warehouse reporting',
      'employment.conduct': 'diligent, dependable and professional in conduct',
      'signatory.name': 'Devika Menon',
      'signatory.title': 'Head of People',
    },
  },
  {
    slug: 'free-salary-slip-template',
    category: 'HR',
    name: 'Salary Slip',
    build: () =>
      tabularRecord({
        title: 'PAYSLIP',
        accent: ACCENT.HR,
        meta: [
          ['Pay period', '{{payslip.period}}'],
          ['Pay date', '{{payslip.pay_date}}'],
          ['Slip no.', '{{payslip.number}}'],
        ],
        details: [
          ['Employee', '{{employee.name}}'],
          ['Employee ID', '{{employee.id}}'],
          ['Designation', '{{employee.designation}}'],
          ['Department', '{{employee.department}}'],
          ['PAN', '{{employee.pan}}'],
          ['Bank A/c', '{{employee.bank_account}}'],
        ],
        sections: [
          {
            heading: 'Earnings',
            columns: [
              { header: 'Component', key: 'component' },
              { header: 'Amount', key: 'amount' },
            ],
            columnWidths: [3, 1],
            dataKey: 'earnings',
            rows: 5,
            height: 118,
          },
          {
            heading: 'Deductions',
            columns: [
              { header: 'Component', key: 'component' },
              { header: 'Amount', key: 'amount' },
            ],
            columnWidths: [3, 1],
            dataKey: 'deductions',
            rows: 4,
            height: 100,
          },
        ],
        totals: [
          { label: 'Gross earnings', value: '{{totals.gross}}' },
          { label: 'Total deductions', value: '{{totals.deductions}}' },
          { label: 'Net pay', value: '{{totals.net}}', strong: true },
        ],
        amountInWords: '{{totals.in_words}}',
        footer: 'This is a computer-generated payslip and does not require a signature.',
      }),
    values: {
      'company.name': 'Northwind Traders Pvt Ltd',
      'company.address': '4th Floor, Prestige Corner, MG Road, Bengaluru 560001',
      'company.contact': 'payroll@northwind.example · +91 80 4123 7788',
      'payslip.period': 'July 2026',
      'payslip.pay_date': '31 July 2026',
      'payslip.number': 'PS/2026/07/0442',
      'employee.name': 'Priya Nair',
      'employee.id': 'NW-2291',
      'employee.designation': 'Senior Operations Analyst',
      'employee.department': 'Supply Chain',
      'employee.pan': 'AFZPN4471K',
      'employee.bank_account': 'XXXX XXXX 8842',
      'totals.gross': '₹1,54,167.00',
      'totals.deductions': '₹24,910.00',
      'totals.net': '₹1,29,257.00',
      'totals.in_words': 'One lakh twenty-nine thousand two hundred fifty-seven rupees only',
      'signatory.name': 'Devika Menon',
      'signatory.title': 'Head of People',
      earnings: rows([
        { component: 'Basic salary', amount: '₹77,083.00' },
        { component: 'House rent allowance', amount: '₹38,542.00' },
        { component: 'Special allowance', amount: '₹27,042.00' },
        { component: 'Conveyance', amount: '₹6,000.00' },
        { component: 'Meal allowance', amount: '₹5,500.00' },
      ]),
      deductions: rows([
        { component: 'Provident fund', amount: '₹9,250.00' },
        { component: 'Professional tax', amount: '₹200.00' },
        { component: 'Income tax (TDS)', amount: '₹14,960.00' },
        { component: 'Insurance premium', amount: '₹500.00' },
      ]),
    },
  },
  {
    slug: 'free-joining-letter-template',
    category: 'HR',
    name: 'Joining Letter',
    build: () =>
      formalLetter({
        title: 'JOINING',
        meta: [
          ['Reference', '{{letter.reference}}'],
          ['Date', '{{letter.date}}'],
        ],
        subject: 'Subject: Confirmation of joining — {{job.title}}',
        salutation: 'Dear {{recipient.first_name}},',
        paragraphs: [
          {
            body: 'This letter confirms that you have joined {{company.name}} as {{job.title}} in the {{job.department}} department with effect from {{job.joining_date}}. Your employee identification number is {{employee.id}}.',
            height: 52,
          },
          {
            body: 'You will report to {{job.reporting_to}} and will be based at our {{job.location}} office. Your terms of employment are as set out in your offer letter dated {{job.offer_date}}, which forms part of your contract with the company.',
            height: 56,
          },
        ],
        terms: {
          heading: 'Please complete before {{job.docs_due}}',
          items: [
            'Submit original academic and experience certificates for verification.',
            'Complete the payroll, provident fund and insurance enrolment forms.',
            'Acknowledge the employee handbook and information security policy.',
            'Provide two references we have not previously contacted.',
          ],
        },
        closing:
          'We are glad to have you with us and look forward to working together.\n\nYours sincerely,',
        footer: '{{company.name}} · {{company.address}} · {{company.contact}}',
      }),
    values: {
      'company.name': 'Northwind Traders Pvt Ltd',
      'company.address': '4th Floor, Prestige Corner, MG Road, Bengaluru 560001',
      'company.contact': 'people@northwind.example · +91 80 4123 7788',
      'letter.reference': 'NW/HR/JOIN/2026/0231',
      'letter.date': '15 September 2026',
      'recipient.name': 'Ms Priya Nair',
      'recipient.first_name': 'Priya',
      'recipient.address': '18 Lakeview Apartments, Indiranagar\nBengaluru, Karnataka 560038',
      'job.title': 'Senior Operations Analyst',
      'job.department': 'Supply Chain',
      'job.joining_date': '15 September 2026',
      'job.reporting_to': 'the Head of Supply Chain',
      'job.location': 'Bengaluru',
      'job.offer_date': '16 August 2026',
      'job.docs_due': '22 September 2026',
      'employee.id': 'NW-2291',
      'signatory.name': 'Devika Menon',
      'signatory.title': 'Head of People, Northwind Traders Pvt Ltd',
    },
  },
  {
    slug: 'free-relieving-letter-template',
    category: 'HR',
    name: 'Relieving Letter',
    build: () =>
      formalLetter({
        title: 'RELIEVING',
        meta: [
          ['Reference', '{{letter.reference}}'],
          ['Date', '{{letter.date}}'],
        ],
        subject: 'Subject: Relieving from services',
        salutation: 'Dear {{recipient.first_name}},',
        paragraphs: [
          {
            body: 'With reference to your resignation dated {{resignation.date}}, we confirm that you have been relieved from your duties as {{employment.designation}} at {{company.name}} at the close of business on {{employment.last_working_day}}.',
            height: 56,
          },
          {
            body: 'You served the organisation from {{employment.from}} to {{employment.last_working_day}}. We confirm that you have completed the agreed notice period, returned all company property, and that no dues remain outstanding on either side.',
            height: 56,
          },
          {
            body: 'Your full and final settlement of {{settlement.amount}} has been processed and will be credited to your registered bank account by {{settlement.date}}. Form 16 for the relevant financial year will be issued in the usual cycle.',
            height: 52,
          },
        ],
        closing:
          'We thank you for your contribution and wish you well in your next role.\n\nFor {{company.name}},',
        footer: 'Issued on request. Please retain this letter for your records.',
      }),
    values: {
      'company.name': 'Northwind Traders Pvt Ltd',
      'company.address': '4th Floor, Prestige Corner, MG Road, Bengaluru 560001',
      'company.contact': 'people@northwind.example · +91 80 4123 7788',
      'letter.reference': 'NW/HR/REL/2026/0091',
      'letter.date': '01 August 2026',
      'recipient.name': 'Mr Arjun Desai',
      'recipient.first_name': 'Arjun',
      'recipient.address': '7 Brookefield Road, Bengaluru 560037',
      'resignation.date': '30 May 2026',
      'employment.designation': 'Logistics Coordinator',
      'employment.from': '04 July 2022',
      'employment.last_working_day': '31 July 2026',
      'settlement.amount': '₹2,14,380.00',
      'settlement.date': '10 August 2026',
      'signatory.name': 'Devika Menon',
      'signatory.title': 'Head of People',
    },
  },

  // ── Education ──────────────────────────────────────────────────────────────
  {
    slug: 'free-course-certificate-template',
    category: 'Education',
    name: 'Course Certificate',
    build: () =>
      certificate({
        heading: 'Certificate of Completion',
        subheading: 'This is to certify that',
        body: 'has successfully completed the course {{course.name}}, comprising {{course.hours}} of instruction and assessment, held from {{course.start_date}} to {{course.end_date}}.',
        detailStrip: [
          ['Grade', '{{course.grade}}'],
          ['Credits', '{{course.credits}}'],
          ['Issued', '{{certificate.date}}'],
        ],
      }),
    values: {
      'institution.name': 'Meridian Institute of Technology',
      'institution.tagline': 'Continuing Professional Education',
      'recipient.name': 'Kavya Ramesh',
      'course.name': 'Applied Data Analysis with Python',
      'course.hours': '48 hours',
      'course.start_date': '05 May 2026',
      'course.end_date': '31 July 2026',
      'course.grade': 'A',
      'course.credits': '4',
      'certificate.date': '08 August 2026',
      'certificate.number': 'MIT/CPE/2026/1174',
      'signatory.name': 'Dr S. Venkataraman',
      'signatory.title': 'Course Director',
      'cosignatory.name': 'Prof. Leela Iyer',
      'cosignatory.title': 'Dean, Continuing Education',
    },
  },
  {
    slug: 'free-achievement-certificate-template',
    category: 'Education',
    name: 'Achievement Certificate',
    build: () =>
      certificate({
        heading: 'Certificate of Achievement',
        subheading: 'Presented with pride to',
        body: 'in recognition of {{achievement.description}} at {{achievement.event}}, held on {{achievement.date}}. This accomplishment reflects sustained effort and genuine distinction.',
        detailStrip: [
          ['Position', '{{achievement.position}}'],
          ['Category', '{{achievement.category}}'],
          ['Awarded', '{{certificate.date}}'],
        ],
      }),
    values: {
      'institution.name': 'Meridian Institute of Technology',
      'institution.tagline': 'Excellence in Learning Since 1974',
      'recipient.name': 'Rohan Bhatt',
      'achievement.description': 'outstanding performance in the inter-college robotics challenge',
      'achievement.event': 'Meridian Tech Fest 2026',
      'achievement.date': '02 August 2026',
      'achievement.position': 'First place',
      'achievement.category': 'Autonomous systems',
      'certificate.date': '05 August 2026',
      'certificate.number': 'MIT/AWD/2026/0312',
      'signatory.name': 'Dr S. Venkataraman',
      'signatory.title': 'Head of Department',
      'cosignatory.name': 'Prof. Leela Iyer',
      'cosignatory.title': 'Principal',
    },
  },
  {
    slug: 'free-marksheet-template',
    category: 'Education',
    name: 'Marksheet',
    build: () =>
      tabularRecord({
        title: 'MARKSHEET',
        accent: ACCENT.Education,
        varPrefix: 'institution',
        meta: [
          ['Academic year', '{{exam.academic_year}}'],
          ['Examination', '{{exam.name}}'],
          ['Sheet no.', '{{exam.sheet_number}}'],
        ],
        details: [
          ['Student', '{{student.name}}'],
          ['Roll number', '{{student.roll_number}}'],
          ['Enrolment no.', '{{student.enrolment_number}}'],
          ['Programme', '{{student.programme}}'],
          ['Semester', '{{student.semester}}'],
          ['Date of birth', '{{student.dob}}'],
        ],
        sections: [
          {
            heading: 'Subject results',
            columns: [
              { header: 'Code', key: 'code' },
              { header: 'Subject', key: 'subject' },
              { header: 'Max', key: 'max' },
              { header: 'Obtained', key: 'obtained' },
              { header: 'Grade', key: 'grade' },
            ],
            columnWidths: [0.8, 3, 0.7, 0.9, 0.7],
            dataKey: 'subjects',
            rows: 6,
            height: 150,
          },
        ],
        totals: [
          { label: 'Total marks', value: '{{result.total}}' },
          { label: 'Percentage', value: '{{result.percentage}}' },
          { label: 'Result', value: '{{result.status}}', strong: true },
        ],
        footer:
          'Issued by the Office of the Controller of Examinations. Any correction must be requested within 30 days.',
      }),
    values: {
      'institution.name': 'Meridian Institute of Technology',
      'institution.address': 'Bannerghatta Road, Bengaluru, Karnataka 560076',
      'institution.contact': 'exams@meridian.example · +91 80 2233 4455',
      'exam.academic_year': '2025–26',
      'exam.name': 'End Semester Examination',
      'exam.sheet_number': 'MIT/EX/2026/44120',
      'student.name': 'Kavya Ramesh',
      'student.roll_number': '21CS0447',
      'student.enrolment_number': 'MIT21CS0447',
      'student.programme': 'B.Tech Computer Science',
      'student.semester': 'Semester VI',
      'student.dob': '14 March 2004',
      'result.total': '512 / 600',
      'result.percentage': '85.33%',
      'result.status': 'PASS — First Class with Distinction',
      'signatory.name': 'Dr M. Raghavan',
      'signatory.title': 'Controller of Examinations',
      subjects: rows([
        { code: 'CS601', subject: 'Design and Analysis of Algorithms', max: '100', obtained: '88', grade: 'A' },
        { code: 'CS602', subject: 'Database Management Systems', max: '100', obtained: '91', grade: 'A+' },
        { code: 'CS603', subject: 'Computer Networks', max: '100', obtained: '79', grade: 'B+' },
        { code: 'CS604', subject: 'Operating Systems', max: '100', obtained: '86', grade: 'A' },
        { code: 'CS605', subject: 'Software Engineering', max: '100', obtained: '84', grade: 'A' },
        { code: 'CS691', subject: 'Mini Project', max: '100', obtained: '84', grade: 'A' },
      ]),
    },
  },
  {
    slug: 'free-id-card-template',
    category: 'Education',
    name: 'ID Card',
    build: () =>
      cardSheet({
        sheetTitle: 'Student identity card — cut and fold',
        accent: ACCENT.Education,
        faces: [
          {
            strapline: 'Student Identity Card · {{card.academic_year}}',
            nameVar: '{{student.name}}',
            photo: true,
            fields: [
              ['ROLL NO', '{{student.roll_number}}'],
              ['PROGRAMME', '{{student.programme}}'],
              ['VALID UNTIL', '{{card.valid_until}}'],
              ['BLOOD GROUP', '{{student.blood_group}}'],
            ],
            footer: 'Card no. {{card.number}} · Property of {{institution.name}}',
          },
          {
            strapline: 'If found, please return to the address below',
            nameVar: 'Emergency contact',
            photo: false,
            fields: [
              ['NAME', '{{emergency.name}}'],
              ['RELATION', '{{emergency.relation}}'],
              ['PHONE', '{{emergency.phone}}'],
              ['ADDRESS', '{{institution.address}}'],
            ],
            footer: 'This card is non-transferable and must be produced on demand.',
          },
        ],
      }),
    values: {
      'institution.name': 'Meridian Institute of Technology',
      'institution.address': 'Bannerghatta Road, Bengaluru 560076',
      'student.name': 'Kavya Ramesh',
      'student.roll_number': '21CS0447',
      'student.programme': 'B.Tech Computer Science',
      'student.blood_group': 'O+',
      'card.academic_year': '2025–26',
      'card.valid_until': '30 June 2027',
      'card.number': 'MIT-ID-44120',
      'emergency.name': 'Sunita Ramesh',
      'emergency.relation': 'Mother',
      'emergency.phone': '+91 98450 22118',
    },
  },
  {
    slug: 'free-admit-card-template',
    category: 'Education',
    name: 'Admit Card',
    build: () =>
      cardSheet({
        sheetTitle: 'Examination admit card — cut along the guides',
        accent: ACCENT.Education,
        faces: [
          {
            strapline: '{{exam.name}} · {{exam.session}}',
            nameVar: '{{candidate.name}}',
            photo: true,
            fields: [
              ['ROLL NO', '{{candidate.roll_number}}'],
              ['CENTRE', '{{exam.centre}}'],
              ['DATE', '{{exam.date}}'],
              ['REPORTING', '{{exam.reporting_time}}'],
            ],
            footer: 'Admit card no. {{exam.admit_number}} · Not valid without invigilator signature',
          },
          {
            strapline: 'Instructions to candidates',
            nameVar: 'Please read before the exam',
            photo: false,
            fields: [
              ['BRING', 'This card and one photo ID'],
              ['ARRIVE', '{{exam.reporting_time}}, gates close 15 min prior'],
              ['PROHIBITED', 'Phones, smart watches, notes'],
              ['QUERIES', '{{institution.contact}}'],
            ],
            footer: 'Candidates found with prohibited material will be disqualified.',
          },
        ],
      }),
    values: {
      'institution.name': 'Meridian Institute of Technology',
      'institution.contact': 'exams@meridian.example',
      'candidate.name': 'Rohan Bhatt',
      'candidate.roll_number': '21EC0189',
      'exam.name': 'End Semester Examination',
      'exam.session': 'June 2026',
      'exam.centre': 'Block C, Hall 4',
      'exam.date': '12 June 2026',
      'exam.reporting_time': '09:15',
      'exam.admit_number': 'MIT/AC/2026/18842',
    },
  },

  // ── Business ───────────────────────────────────────────────────────────────
  {
    slug: 'free-contract-template',
    category: 'Business',
    name: 'Contract',
    build: () =>
      longFormDoc({
        title: 'Services Agreement',
        subtitle: 'This agreement records the terms on which the services described below will be provided.',
        meta: [
          ['Agreement no.', '{{agreement.number}}'],
          ['Effective date', '{{agreement.effective_date}}'],
          ['Term', '{{agreement.term}}'],
          ['Governing law', '{{agreement.governing_law}}'],
        ],
        parties: [
          {
            heading: 'Party one',
            lines: ['{{party_one.name}}', '{{party_one.address}}', '{{party_one.registration}}'],
          },
          {
            heading: 'Party two',
            lines: ['{{party_two.name}}', '{{party_two.address}}', '{{party_two.registration}}'],
          },
        ],
        sections: [
          {
            heading: '1. Scope of services',
            body: '{{agreement.scope}}',
            height: 46,
          },
          {
            heading: '2. Fees and payment',
            body: '{{agreement.fees}}',
            height: 40,
          },
          {
            heading: '3. Obligations',
            items: [
              'Each party shall perform its obligations with reasonable skill and care.',
              'Neither party may assign this agreement without prior written consent.',
              'Each party shall comply with applicable law in performing this agreement.',
            ],
          },
          {
            heading: '4. Termination',
            body: 'Either party may terminate this agreement on {{agreement.notice}} written notice. Termination does not affect accrued rights or obligations that by their nature survive.',
            height: 40,
          },
        ],
        footer: 'Executed in two counterparts, each of which is an original.',
      }),
    values: {
      'agreement.number': 'AGR-2026-0057',
      'agreement.effective_date': '01 September 2026',
      'agreement.term': '24 months',
      'agreement.governing_law': 'India',
      'agreement.notice': '60 days',
      'agreement.scope':
        'The Supplier shall provide warehousing, pick-and-pack fulfilment and last-mile dispatch services for the Customer across the Bengaluru metropolitan area, in accordance with the service levels set out in Schedule A.',
      'agreement.fees':
        'Fees are payable monthly in arrears within 30 days of a valid invoice, calculated at the rates set out in Schedule B.',
      'party_one.name': 'Northwind Traders Pvt Ltd',
      'party_one.address': '4th Floor, Prestige Corner, MG Road, Bengaluru 560001',
      'party_one.registration': 'CIN U51909KA2016PTC091822',
      'party_one.signatory': 'Ananya Rao',
      'party_two.name': 'Halcyon Design Studio LLP',
      'party_two.address': '22 Residency Road, Bengaluru 560025',
      'party_two.registration': 'LLPIN AAF-2291',
      'party_two.signatory': 'Meera Krishnan',
    },
  },
  {
    slug: 'free-nda-template',
    category: 'Business',
    name: 'NDA',
    build: () =>
      longFormDoc({
        title: 'Non-Disclosure Agreement',
        subtitle: 'A mutual agreement governing the exchange of confidential information between the parties.',
        meta: [
          ['Agreement no.', '{{agreement.number}}'],
          ['Effective date', '{{agreement.effective_date}}'],
          ['Confidentiality period', '{{agreement.confidentiality_period}}'],
          ['Governing law', '{{agreement.governing_law}}'],
        ],
        parties: [
          {
            heading: 'Disclosing party',
            lines: ['{{party_one.name}}', '{{party_one.address}}', '{{party_one.registration}}'],
          },
          {
            heading: 'Receiving party',
            lines: ['{{party_two.name}}', '{{party_two.address}}', '{{party_two.registration}}'],
          },
        ],
        intro:
          'The parties wish to explore {{agreement.purpose}} and, in doing so, may disclose confidential information to one another. This agreement sets out how that information must be handled.',
        sections: [
          {
            heading: '1. Confidential information',
            body: 'Confidential information means any non-public information disclosed by one party to the other, in any form, that is marked confidential or that a reasonable person would understand to be confidential given its nature and the circumstances of disclosure.',
            height: 46,
          },
          {
            heading: '2. Obligations of the receiving party',
            items: [
              'Use the confidential information solely for the stated purpose.',
              'Disclose it only to personnel who need it and are bound by equivalent obligations.',
              'Protect it with at least the same care used for its own confidential information.',
              'Return or destroy it on written request or on termination of this agreement.',
            ],
          },
          {
            heading: '3. Exclusions',
            body: 'These obligations do not apply to information that is or becomes public through no breach of this agreement, was already known to the receiving party without obligation, is independently developed without reference to the disclosure, or must be disclosed by law.',
            height: 46,
          },
        ],
        footer: 'Nothing in this agreement grants any licence or ownership in the confidential information.',
      }),
    values: {
      'agreement.number': 'NDA-2026-0219',
      'agreement.effective_date': '16 August 2026',
      'agreement.confidentiality_period': '3 years',
      'agreement.governing_law': 'India',
      'agreement.purpose': 'a potential logistics partnership',
      'party_one.name': 'Northwind Traders Pvt Ltd',
      'party_one.address': '4th Floor, Prestige Corner, MG Road, Bengaluru 560001',
      'party_one.registration': 'CIN U51909KA2016PTC091822',
      'party_one.signatory': 'Ananya Rao',
      'party_two.name': 'Sterling Components Pvt Ltd',
      'party_two.address': 'Plot 14, Peenya Industrial Area, Bengaluru 560058',
      'party_two.registration': 'CIN U29253KA2011PTC058117',
      'party_two.signatory': 'K. Balasubramanian',
    },
  },
  {
    slug: 'free-business-proposal-template',
    category: 'Business',
    name: 'Business Proposal',
    build: () =>
      longFormDoc({
        title: '{{proposal.title}}',
        subtitle: 'Prepared for {{client.name}} by {{company.name}}',
        meta: [
          ['Proposal no.', '{{proposal.number}}'],
          ['Date', '{{proposal.date}}'],
          ['Valid until', '{{proposal.valid_until}}'],
          ['Prepared by', '{{proposal.author}}'],
        ],
        intro: '{{proposal.summary}}',
        sections: [
          {
            heading: 'The problem we are solving',
            body: '{{proposal.problem}}',
            height: 52,
          },
          {
            heading: 'Our approach',
            items: [
              '{{proposal.approach_one}}',
              '{{proposal.approach_two}}',
              '{{proposal.approach_three}}',
            ],
          },
          {
            heading: 'Investment',
            table: {
              columns: [
                { header: 'Phase', key: 'phase' },
                { header: 'Deliverable', key: 'deliverable' },
                { header: 'Duration', key: 'duration' },
                { header: 'Fee', key: 'fee' },
              ],
              columnWidths: [1, 2.6, 1, 1.1],
              dataKey: 'phases',
              rows: 3,
              height: 92,
            },
          },
        ],
        signatures: false,
        footer: 'This proposal is confidential and prepared solely for {{client.name}}.',
      }),
    values: {
      'company.name': 'Northwind Traders Pvt Ltd',
      'client.name': 'Halcyon Design Studio LLP',
      'proposal.title': 'Warehouse Automation Programme',
      'proposal.number': 'PRP-2026-0033',
      'proposal.date': '16 August 2026',
      'proposal.valid_until': '30 September 2026',
      'proposal.author': 'Vikram Shetty',
      'proposal.summary':
        'This proposal sets out a phased programme to reduce order-to-dispatch time at the Hosur Road facility from an average of 38 hours to under 12, without expanding headcount.',
      'proposal.problem':
        'Order picking is currently paper-driven, with three manual handoffs between receipt and dispatch. Each handoff is a point where orders stall, and none of them is instrumented — so the delay is visible only after the fact, in customer complaints.',
      'proposal.approach_one':
        'Instrument the existing process first, so improvements can be measured rather than assumed.',
      'proposal.approach_two':
        'Replace the paper pick list with handheld scanning, removing two of the three handoffs.',
      'proposal.approach_three':
        'Introduce wave planning so dispatch cut-offs drive picking priority automatically.',
      phases: rows([
        { phase: 'Phase 1', deliverable: 'Baseline instrumentation and reporting', duration: '4 weeks', fee: '₹4,20,000' },
        { phase: 'Phase 2', deliverable: 'Handheld scanning rollout and training', duration: '8 weeks', fee: '₹11,60,000' },
        { phase: 'Phase 3', deliverable: 'Wave planning and dispatch integration', duration: '6 weeks', fee: '₹7,80,000' },
      ]),
    },
  },
  {
    slug: 'free-report-template',
    category: 'Business',
    name: 'Report',
    build: () =>
      longFormDoc({
        title: '{{report.title}}',
        subtitle: '{{report.subtitle}}',
        meta: [
          ['Report no.', '{{report.number}}'],
          ['Period', '{{report.period}}'],
          ['Prepared by', '{{report.author}}'],
          ['Status', '{{report.status}}'],
        ],
        intro: '{{report.summary}}',
        sections: [
          {
            heading: 'Key figures',
            table: {
              columns: [
                { header: 'Metric', key: 'metric' },
                { header: 'This period', key: 'current' },
                { header: 'Previous', key: 'previous' },
                { header: 'Change', key: 'change' },
              ],
              columnWidths: [2.4, 1.1, 1.1, 0.9],
              dataKey: 'metrics',
              rows: 5,
              height: 132,
            },
          },
          {
            heading: 'Observations',
            items: ['{{report.observation_one}}', '{{report.observation_two}}', '{{report.observation_three}}'],
          },
          {
            heading: 'Recommended actions',
            body: '{{report.recommendations}}',
            height: 46,
          },
        ],
        signatures: false,
        footer: 'Circulated to the leadership team. Figures are unaudited unless stated otherwise.',
      }),
    values: {
      'report.title': 'Quarterly Operations Review',
      'report.subtitle': 'Fulfilment performance, cost per order and service levels',
      'report.number': 'OPS-2026-Q2',
      'report.period': 'Apr–Jun 2026',
      'report.author': 'R. Subramanian',
      'report.status': 'Final',
      'report.summary':
        'Order volume grew 18% quarter on quarter while cost per order fell 6%, driven mainly by the consolidation of inbound freight. Service levels held steady, though the dispatch cut-off was missed on eleven occasions in June.',
      'report.observation_one':
        'Cost per order improved for the third consecutive quarter, but the rate of improvement is slowing.',
      'report.observation_two':
        'All eleven missed cut-offs in June occurred on days when inbound receipts exceeded 400 units.',
      'report.observation_three':
        'Returns processing remains the longest single step at an average of 4.2 days.',
      'report.recommendations':
        'Add a second receiving bay before the festive peak, and instrument returns processing so the 4.2-day average can be broken down by cause rather than estimated.',
      metrics: rows([
        { metric: 'Orders dispatched', current: '48,210', previous: '40,844', change: '+18.0%' },
        { metric: 'Cost per order', current: '₹64.20', previous: '₹68.30', change: '−6.0%' },
        { metric: 'On-time dispatch', current: '97.4%', previous: '97.6%', change: '−0.2pp' },
        { metric: 'Order accuracy', current: '99.1%', previous: '98.7%', change: '+0.4pp' },
        { metric: 'Returns processed', current: '2,118', previous: '1,905', change: '+11.2%' },
      ]),
    },
  },
  {
    slug: 'free-statement-template',
    category: 'Business',
    name: 'Statement',
    build: () =>
      financialDoc({
        title: 'STATEMENT',
        meta: [
          ['Statement no.', '{{statement.number}}'],
          ['Period', '{{statement.period}}'],
          ['Issued', '{{statement.date}}'],
        ],
        partyHeading: 'Account',
        partyLines: ['{{customer.name}}', '{{customer.address}}', 'Account {{customer.account_number}}'],
        strip: [
          ['Opening balance', '{{balances.opening}}'],
          ['Payments received', '{{balances.payments}}'],
          ['Closing balance', '{{balances.closing}}'],
        ],
        columns: [
          { header: 'Date', key: 'date' },
          { header: 'Reference', key: 'reference' },
          { header: 'Description', key: 'description' },
          { header: 'Debit', key: 'debit' },
          { header: 'Credit', key: 'credit' },
          { header: 'Balance', key: 'balance' },
        ],
        columnWidths: [1, 1.2, 2.4, 1, 1, 1.1],
        dataKey: 'transactions',
        rows: 6,
        tableHeight: 158,
        totals: [
          { label: 'Current', value: '{{ageing.current}}' },
          { label: '31–60 days', value: '{{ageing.thirty}}' },
          { label: '61–90 days', value: '{{ageing.sixty}}' },
          { label: 'Amount due', value: '{{balances.closing}}', strong: true },
        ],
        notes: {
          heading: 'Remittance',
          body: '{{statement.remittance}}',
        },
        signName: '{{signatory.name}}',
        signRole: 'Accounts receivable, {{company.name}}',
        footer: 'Please report any discrepancy within 15 days of the statement date.',
      }),
    values: {
      ...COMPANY,
      ...CUSTOMER_VALUES,
      'customer.account_number': 'NW-CUST-01184',
      'statement.number': 'STM-2026-08-0184',
      'statement.period': '01 Jul – 31 Jul 2026',
      'statement.date': '01 August 2026',
      'statement.remittance':
        'Bank transfer to Northwind Traders Pvt Ltd\nA/c 5010 2233 8891 · IFSC HDFC0000512\nQuote your account number with every payment.',
      'balances.opening': '₹86,400.00',
      'balances.payments': '₹86,400.00',
      'balances.closing': '₹94,340.00',
      'ageing.current': '₹94,340.00',
      'ageing.thirty': '₹0.00',
      'ageing.sixty': '₹0.00',
      'signatory.name': 'Ananya Rao',
      transactions: rows([
        { date: '01 Jul', reference: '—', description: 'Opening balance', debit: '', credit: '', balance: '₹86,400.00' },
        { date: '04 Jul', reference: 'INV-0177', description: 'Design retainer — July', debit: '₹59,000.00', credit: '', balance: '₹1,45,400.00' },
        { date: '12 Jul', reference: 'RCP-0388', description: 'Payment received — NEFT', debit: '', credit: '₹86,400.00', balance: '₹59,000.00' },
        { date: '18 Jul', reference: 'INV-0181', description: 'Print collateral adaptation', debit: '₹35,340.00', credit: '', balance: '₹94,340.00' },
        { date: '26 Jul', reference: 'CN-0044', description: 'Credit note — reprint allowance', debit: '', credit: '₹0.00', balance: '₹94,340.00' },
        { date: '31 Jul', reference: '—', description: 'Closing balance', debit: '', credit: '', balance: '₹94,340.00' },
      ]),
    },
  },

  // ── Finance ────────────────────────────────────────────────────────────────

  {
    slug: 'free-proforma-invoice-template',
    category: 'Finance',
    name: 'Proforma Invoice',
    build: () =>
      financialDoc({
        title: 'PROFORMA INVOICE',
        meta: [
          ['Proforma no.', '{{proforma.number}}'],
          ['Date', '{{proforma.date}}'],
          ['Valid until', '{{proforma.valid_until}}'],
        ],
        partyHeading: 'Bill to',
        partyLines: CUSTOMER.slice(0, 2),
        strip: [
          ['Currency', '{{proforma.currency}}'],
          ['Incoterms', '{{proforma.incoterms}}'],
          ['Lead time', '{{proforma.lead_time}}'],
        ],
        columns: [
          { header: 'Description', key: 'description' },
          { header: 'Qty', key: 'qty' },
          { header: 'Rate', key: 'rate' },
          { header: 'Amount', key: 'amount' },
        ],
        columnWidths: [3.2, 0.7, 1, 1.1],
        dataKey: 'line_items',
        rows: 4,
        totals: [
          { label: 'Subtotal', value: '{{totals.subtotal}}' },
          { label: 'Estimated tax', value: '{{totals.tax}}' },
          { label: 'Estimated total', value: '{{totals.grand_total}}', strong: true },
        ],
        amountInWords: '{{totals.in_words}}',
        notes: {
          heading: 'Not a tax invoice',
          body: '{{proforma.disclaimer}}',
        },
        signName: '{{signatory.name}}',
        signRole: 'For {{company.name}}',
        footer: 'A tax invoice will be issued once the goods are dispatched.',
      }),
    values: {
      ...COMPANY,
      ...CUSTOMER_VALUES,
      'proforma.number': 'PI-2026-0091',
      'proforma.date': '17 Aug 2026',
      'proforma.valid_until': '16 Sep 2026',
      'proforma.currency': 'INR (₹)',
      'proforma.incoterms': 'FOB Bengaluru',
      'proforma.lead_time': '3–4 weeks from order',
      'totals.subtotal': '₹2,86,000.00',
      'totals.tax': '₹51,480.00',
      'totals.grand_total': '₹3,37,480.00',
      'totals.in_words': 'Three lakh thirty-seven thousand four hundred eighty rupees only',
      'proforma.disclaimer':
        'This document is issued for quotation and customs purposes only.\nIt is not a demand for payment and carries no GST liability.',
      'signatory.name': 'Ananya Rao',
      line_items: rows([
        { description: 'Industrial shelving unit — 2400mm', qty: '20', rate: '₹9,800.00', amount: '₹1,96,000.00' },
        { description: 'Workbench with vice — 1800mm', qty: '6', rate: '₹11,500.00', amount: '₹69,000.00' },
        { description: 'Assembly and installation', qty: '1', rate: '₹15,000.00', amount: '₹15,000.00' },
        { description: 'Freight to site', qty: '1', rate: '₹6,000.00', amount: '₹6,000.00' },
      ]),
    },
  },

  {
    slug: 'free-credit-note-template',
    category: 'Finance',
    name: 'Credit Note',
    build: () =>
      financialDoc({
        title: 'CREDIT NOTE',
        meta: [
          ['Credit note no.', '{{note.number}}'],
          ['Date', '{{note.date}}'],
          ['Against invoice', '{{note.against_invoice}}'],
        ],
        partyHeading: 'Issued to',
        partyLines: CUSTOMER.slice(0, 2),
        strip: [
          ['Reason', '{{note.reason}}'],
          ['Invoice date', '{{note.invoice_date}}'],
          ['GSTIN', '{{customer.gstin}}'],
        ],
        columns: [
          { header: 'Description', key: 'description' },
          { header: 'Qty', key: 'qty' },
          { header: 'Rate', key: 'rate' },
          { header: 'Amount', key: 'amount' },
        ],
        columnWidths: [3.2, 0.7, 1, 1.1],
        dataKey: 'line_items',
        rows: 3,
        totals: [
          { label: 'Taxable value', value: '{{totals.subtotal}}' },
          { label: 'GST reversed', value: '{{totals.tax}}' },
          { label: 'Total credited', value: '{{totals.grand_total}}', strong: true },
        ],
        amountInWords: '{{totals.in_words}}',
        notes: {
          heading: 'How this credit is applied',
          body: '{{note.settlement}}',
        },
        signName: '{{signatory.name}}',
        signRole: 'For {{company.name}}',
        footer: 'Please retain this note with the original invoice for your GST records.',
      }),
    values: {
      ...COMPANY,
      ...CUSTOMER_VALUES,
      'note.number': 'CN-2026-0042',
      'note.date': '17 Aug 2026',
      'note.against_invoice': 'INV-2026-0184',
      'note.invoice_date': '16 Aug 2026',
      'note.reason': 'Goods returned — damaged in transit',
      'totals.subtotal': '₹34,000.00',
      'totals.tax': '₹6,120.00',
      'totals.grand_total': '₹40,120.00',
      'totals.in_words': 'Forty thousand one hundred twenty rupees only',
      'note.settlement':
        'This credit will be set against your next invoice.\nWhere no further invoice is due, it is refundable on written request.',
      'signatory.name': 'Ananya Rao',
      line_items: rows([
        { description: 'Steel shelving unit — returned', qty: '2', rate: '₹14,000.00', amount: '₹28,000.00' },
        { description: 'Shipping charge — reversed', qty: '1', rate: '₹4,000.00', amount: '₹4,000.00' },
        { description: 'Handling adjustment', qty: '1', rate: '₹2,000.00', amount: '₹2,000.00' },
      ]),
    },
  },

  {
    slug: 'free-debit-note-template',
    category: 'Finance',
    name: 'Debit Note',
    build: () =>
      financialDoc({
        title: 'DEBIT NOTE',
        meta: [
          ['Debit note no.', '{{note.number}}'],
          ['Date', '{{note.date}}'],
          ['Against invoice', '{{note.against_invoice}}'],
        ],
        partyHeading: 'Raised on',
        partyLines: CUSTOMER.slice(0, 2),
        strip: [
          ['Reason', '{{note.reason}}'],
          ['Invoice date', '{{note.invoice_date}}'],
          ['GSTIN', '{{customer.gstin}}'],
        ],
        columns: [
          { header: 'Description', key: 'description' },
          { header: 'Qty', key: 'qty' },
          { header: 'Rate', key: 'rate' },
          { header: 'Amount', key: 'amount' },
        ],
        columnWidths: [3.2, 0.7, 1, 1.1],
        dataKey: 'line_items',
        rows: 3,
        totals: [
          { label: 'Taxable value', value: '{{totals.subtotal}}' },
          { label: 'GST', value: '{{totals.tax}}' },
          { label: 'Total debited', value: '{{totals.grand_total}}', strong: true },
        ],
        amountInWords: '{{totals.in_words}}',
        notes: {
          heading: 'Why this note was raised',
          body: '{{note.explanation}}',
        },
        signName: '{{signatory.name}}',
        signRole: 'For {{company.name}}',
        footer: 'Payable with your next settlement. Queries to {{company.contact}}',
      }),
    values: {
      ...COMPANY,
      ...CUSTOMER_VALUES,
      'note.number': 'DN-2026-0018',
      'note.date': '17 Aug 2026',
      'note.against_invoice': 'INV-2026-0177',
      'note.invoice_date': '04 Jul 2026',
      'note.reason': 'Short billing — rate revision applied late',
      'totals.subtotal': '₹18,500.00',
      'totals.tax': '₹3,330.00',
      'totals.grand_total': '₹21,830.00',
      'totals.in_words': 'Twenty-one thousand eight hundred thirty rupees only',
      'note.explanation':
        'The original invoice applied the previous contract rate.\nThis note recovers the difference agreed in the revision dated 01 July 2026.',
      'signatory.name': 'Ananya Rao',
      line_items: rows([
        { description: 'Rate revision — shelving units', qty: '10', rate: '₹1,200.00', amount: '₹12,000.00' },
        { description: 'Rate revision — workbenches', qty: '4', rate: '₹1,375.00', amount: '₹5,500.00' },
        { description: 'Freight differential', qty: '1', rate: '₹1,000.00', amount: '₹1,000.00' },
      ]),
    },
  },

  {
    slug: 'free-delivery-challan-template',
    category: 'Finance',
    name: 'Delivery Challan',
    build: () =>
      financialDoc({
        title: 'DELIVERY CHALLAN',
        meta: [
          ['Challan no.', '{{challan.number}}'],
          ['Date', '{{challan.date}}'],
          ['Order ref.', '{{challan.order_reference}}'],
        ],
        partyHeading: 'Consignee',
        partyLines: CUSTOMER.slice(0, 2),
        secondParty: {
          heading: 'Ship to',
          lines: ['{{shipping.name}}', '{{shipping.address}}'],
        },
        strip: [
          ['Vehicle no.', '{{challan.vehicle}}'],
          ['E-way bill', '{{challan.eway_bill}}'],
          ['Transport mode', '{{challan.transport_mode}}'],
        ],
        columns: [
          { header: 'Description of goods', key: 'description' },
          { header: 'HSN', key: 'hsn' },
          { header: 'Qty', key: 'qty' },
          { header: 'Value', key: 'value' },
        ],
        columnWidths: [3, 0.9, 0.7, 1.1],
        dataKey: 'line_items',
        rows: 4,
        totals: [
          { label: 'Declared value', value: '{{totals.grand_total}}', strong: true },
        ],
        amountInWords: '{{totals.in_words}}',
        notes: {
          heading: 'Purpose of movement',
          body: '{{challan.purpose}}',
        },
        signName: '{{signatory.name}}',
        signRole: 'For {{company.name}}',
        footer: 'Not a tax invoice. Goods moved under the reference shown above.',
      }),
    values: {
      ...COMPANY,
      ...CUSTOMER_VALUES,
      'challan.number': 'DC-2026-0311',
      'challan.date': '17 Aug 2026',
      'challan.order_reference': 'PO-2026-1148',
      'challan.vehicle': 'KA 05 MJ 4471',
      'challan.eway_bill': '4712 8890 3315',
      'challan.transport_mode': 'Road',
      'shipping.name': 'Halcyon Design Studio — Warehouse',
      'shipping.address': 'Warehouse 3, Hosur Road, Bengaluru 560068',
      'totals.grand_total': '₹2,14,000.00',
      'totals.in_words': 'Two lakh fourteen thousand rupees only',
      'challan.purpose':
        'Supply against purchase order. Goods remain the property of the consignor until accepted at the delivery address.',
      'signatory.name': 'Ananya Rao',
      line_items: rows([
        { description: 'Industrial shelving unit — 2400mm', hsn: '9403', qty: '20', value: '₹1,96,000.00' },
        { description: 'Fixing kit — wall anchors', hsn: '7318', qty: '20', value: '₹8,000.00' },
        { description: 'Assembly tool set', hsn: '8205', qty: '2', value: '₹6,000.00' },
        { description: 'Protective wrap — roll', hsn: '3923', qty: '4', value: '₹4,000.00' },
      ]),
    },
  },

  {
    slug: 'free-petty-cash-voucher-template',
    category: 'Finance',
    name: 'Petty Cash Voucher',
    build: () =>
      financialDoc({
        title: 'PETTY CASH VOUCHER',
        meta: [
          ['Voucher no.', '{{voucher.number}}'],
          ['Date', '{{voucher.date}}'],
          ['Cost centre', '{{voucher.cost_centre}}'],
        ],
        partyHeading: 'Paid to',
        partyLines: ['{{payee.name}}', '{{payee.department}}'],
        strip: [
          ['Paid by', '{{voucher.paid_by}}'],
          ['Method', '{{voucher.method}}'],
          ['Approved by', '{{voucher.approved_by}}'],
        ],
        columns: [
          { header: 'Particulars', key: 'description' },
          { header: 'Account', key: 'account' },
          { header: 'Amount', key: 'amount' },
        ],
        columnWidths: [3, 1.2, 1.1],
        dataKey: 'line_items',
        rows: 4,
        totals: [
          { label: 'Total claimed', value: '{{totals.grand_total}}', strong: true },
        ],
        amountInWords: '{{totals.in_words}}',
        notes: {
          heading: 'Receipts attached',
          body: '{{voucher.receipts}}',
        },
        signName: '{{payee.name}}',
        signRole: 'Received by',
        footer: 'Attach original receipts. Vouchers without receipts cannot be reimbursed.',
      }),
    values: {
      ...COMPANY,
      'voucher.number': 'PCV-2026-0264',
      'voucher.date': '17 Aug 2026',
      'voucher.cost_centre': 'Operations — Bengaluru',
      'voucher.paid_by': 'Petty cash float',
      'voucher.method': 'Cash',
      'voucher.approved_by': 'Ananya Rao, Finance Manager',
      'payee.name': 'Rahul Sharma',
      'payee.department': 'Warehouse Operations',
      'totals.grand_total': '₹4,850.00',
      'totals.in_words': 'Four thousand eight hundred fifty rupees only',
      'voucher.receipts': '4 receipts attached and initialled by the claimant.',
      line_items: rows([
        { description: 'Courier — documents to Chennai', account: 'Postage', amount: '₹1,250.00' },
        { description: 'Stationery — labels and markers', account: 'Consumables', amount: '₹1,400.00' },
        { description: 'Auto fare — bank and back', account: 'Local travel', amount: '₹600.00' },
        { description: 'Refreshments — audit visit', account: 'Hospitality', amount: '₹1,600.00' },
      ]),
    },
  },

  {
    slug: 'free-expense-report-template',
    category: 'Finance',
    name: 'Expense Report',
    build: () =>
      tabularRecord({
        title: 'EXPENSE REPORT',
        accent: ACCENT.Finance,
        meta: [
          ['Report no.', '{{report.number}}'],
          ['Period', '{{report.period}}'],
          ['Submitted', '{{report.submitted}}'],
        ],
        details: [
          ['Employee', '{{employee.name}}'],
          ['Employee ID', '{{employee.id}}'],
          ['Department', '{{employee.department}}'],
          ['Cost centre', '{{report.cost_centre}}'],
          ['Approver', '{{report.approver}}'],
          ['Reimburse to', '{{employee.bank_account}}'],
        ],
        sections: [
          {
            heading: 'Travel and accommodation',
            columns: [
              { header: 'Date', key: 'date' },
              { header: 'Particulars', key: 'description' },
              { header: 'Amount', key: 'amount' },
            ],
            columnWidths: [1, 3, 1.1],
            dataKey: 'travel',
            rows: 4,
            height: 100,
          },
          {
            heading: 'Other expenses',
            columns: [
              { header: 'Date', key: 'date' },
              { header: 'Particulars', key: 'description' },
              { header: 'Amount', key: 'amount' },
            ],
            columnWidths: [1, 3, 1.1],
            dataKey: 'other',
            rows: 3,
            height: 82,
          },
        ],
        totals: [
          { label: 'Travel and accommodation', value: '{{totals.travel}}' },
          { label: 'Other expenses', value: '{{totals.other}}' },
          { label: 'Total reimbursable', value: '{{totals.net}}', strong: true },
        ],
        amountInWords: '{{totals.in_words}}',
        footer: 'Claims must be submitted within 30 days of the expense date, with receipts.',
      }),
    values: {
      ...COMPANY,
      'report.number': 'EXP-2026-0128',
      'report.period': '01–31 July 2026',
      'report.submitted': '05 August 2026',
      'report.cost_centre': 'Sales — South',
      'report.approver': 'Devika Menon, Regional Head',
      'employee.name': 'Rahul Sharma',
      'employee.id': 'NW-2291',
      'employee.department': 'Field Sales',
      'employee.bank_account': 'HDFC ••••4417',
      'totals.travel': '₹28,400.00',
      'totals.other': '₹6,150.00',
      'totals.net': '₹34,550.00',
      'totals.in_words': 'Thirty-four thousand five hundred fifty rupees only',
      'signatory.name': 'Devika Menon',
      'signatory.title': 'Regional Head, Sales',
      travel: rows([
        { date: '04 Jul', description: 'Flight BLR–HYD, economy', amount: '₹8,900.00' },
        { date: '04 Jul', description: 'Hotel — 2 nights, Hyderabad', amount: '₹12,400.00' },
        { date: '06 Jul', description: 'Flight HYD–BLR, economy', amount: '₹6,100.00' },
        { date: '18 Jul', description: 'Cab — client visits, Chennai', amount: '₹1,000.00' },
      ]),
      other: rows([
        { date: '05 Jul', description: 'Client lunch — 3 attendees', amount: '₹3,250.00' },
        { date: '12 Jul', description: 'Printing — proposal copies', amount: '₹1,400.00' },
        { date: '22 Jul', description: 'Mobile data top-up', amount: '₹1,500.00' },
      ]),
    },
  },

  // ── HR ─────────────────────────────────────────────────────────────────────

  {
    slug: 'free-appointment-letter-template',
    category: 'HR',
    name: 'Appointment Letter',
    build: () =>
      formalLetter({
        title: 'APPOINTMENT',
        meta: [
          ['Reference', '{{letter.reference}}'],
          ['Date', '{{letter.date}}'],
        ],
        subject: 'Subject: Appointment as {{job.title}}',
        salutation: 'Dear {{recipient.first_name}},',
        paragraphs: [
          {
            body: 'Further to your acceptance of our offer, we are pleased to confirm your appointment as {{job.title}} in the {{job.department}} team at {{company.name}}, effective {{job.start_date}}.',
            height: 50,
          },
          {
            body: 'You will report to {{job.reporting_to}} at our {{job.location}} office. Your appointment is governed by the terms below and by the employee handbook, a copy of which has been provided to you.',
            height: 50,
          },
        ],
        terms: {
          heading: 'Terms of appointment',
          items: [
            'Annual cost to company: {{job.ctc}}, reviewed each {{job.review_month}}.',
            'Probation: {{job.probation}}, extendable at the company’s discretion.',
            'Notice period: {{job.notice_period}} once confirmed in the role.',
            'Working hours: {{job.hours}}, with flexibility as the role requires.',
            'You confirm you are not bound by any agreement that conflicts with this appointment.',
          ],
        },
        closing:
          'Please sign and return the enclosed copy of this letter as confirmation of your acceptance.\n\nYours sincerely,',
        footer: '{{company.name}} · {{company.address}} · {{company.contact}}',
      }),
    values: {
      'company.name': 'Northwind Traders Pvt Ltd',
      'company.address': '4th Floor, Prestige Corner, MG Road, Bengaluru 560001',
      'company.contact': 'people@northwind.example · +91 80 4123 7788',
      'letter.reference': 'NW/HR/2026/0248',
      'letter.date': '17 August 2026',
      'recipient.name': 'Ms Priya Nair',
      'recipient.first_name': 'Priya',
      'recipient.address': '18 Lakeview Apartments, Indiranagar\nBengaluru, Karnataka 560038',
      'job.title': 'Senior Operations Analyst',
      'job.department': 'Supply Chain',
      'job.start_date': '15 September 2026',
      'job.reporting_to': 'the Head of Supply Chain',
      'job.location': 'Bengaluru',
      'job.ctc': '₹18,50,000 per annum',
      'job.review_month': 'April',
      'job.probation': 'Six months',
      'job.notice_period': 'Two months',
      'job.hours': '9.30am to 6.00pm, Monday to Friday',
      'signatory.name': 'Devika Menon',
      'signatory.title': 'Head of People, Northwind Traders Pvt Ltd',
    },
  },

  {
    slug: 'free-internship-certificate-template',
    category: 'HR',
    name: 'Internship Certificate',
    build: () =>
      formalLetter({
        title: 'CERTIFICATE',
        meta: [
          ['Reference', '{{letter.reference}}'],
          ['Date', '{{letter.date}}'],
        ],
        subject: 'To whom it may concern',
        salutation: '',
        paragraphs: [
          {
            body: 'This is to certify that {{recipient.name}} completed an internship with {{company.name}} in the {{intern.department}} team, from {{intern.start_date}} to {{intern.end_date}}.',
            height: 50,
          },
          {
            body: 'During the internship {{recipient.first_name}} worked on {{intern.project}}, reporting to {{intern.mentor}}. The work was carried out with diligence and a willingness to learn, and the contribution was of real value to the team.',
            height: 58,
          },
        ],
        terms: {
          heading: 'Internship details',
          items: [
            'Duration: {{intern.duration}}.',
            'Mode: {{intern.mode}}.',
            'Stipend: {{intern.stipend}}.',
            'Conduct during the internship was found to be satisfactory throughout.',
          ],
        },
        closing:
          'We wish {{recipient.first_name}} every success in the next stage of study and career.\n\nYours sincerely,',
        footer: '{{company.name}} · {{company.address}} · {{company.contact}}',
      }),
    values: {
      'company.name': 'Northwind Traders Pvt Ltd',
      'company.address': '4th Floor, Prestige Corner, MG Road, Bengaluru 560001',
      'company.contact': 'people@northwind.example · +91 80 4123 7788',
      'letter.reference': 'NW/HR/INT/2026/0077',
      'letter.date': '17 August 2026',
      'recipient.name': 'Mr Arjun Deshpande',
      'recipient.first_name': 'Arjun',
      'recipient.address': 'Department of Computer Science\nMeridian Institute of Technology, Pune 411014',
      'intern.department': 'Data and Analytics',
      'intern.start_date': '02 June 2026',
      'intern.end_date': '08 August 2026',
      'intern.project': 'a demand-forecasting dashboard for the warehouse team',
      'intern.mentor': 'Sneha Kulkarni, Analytics Lead',
      'intern.duration': 'Ten weeks, full time',
      'intern.mode': 'On-site, Bengaluru office',
      'intern.stipend': '₹25,000 per month',
      'signatory.name': 'Devika Menon',
      'signatory.title': 'Head of People, Northwind Traders Pvt Ltd',
    },
  },

  {
    slug: 'free-resignation-acceptance-letter-template',
    category: 'HR',
    name: 'Resignation Acceptance Letter',
    build: () =>
      formalLetter({
        title: 'ACCEPTANCE',
        meta: [
          ['Reference', '{{letter.reference}}'],
          ['Date', '{{letter.date}}'],
        ],
        subject: 'Subject: Acceptance of resignation',
        salutation: 'Dear {{recipient.first_name}},',
        paragraphs: [
          {
            body: 'We acknowledge receipt of your resignation letter dated {{resignation.received_date}} from the position of {{job.title}} in the {{job.department}} team. Your resignation is accepted.',
            height: 50,
          },
          {
            body: 'Your last working day will be {{resignation.last_working_day}}, on completion of your notice period. Please work with {{resignation.handover_to}} to complete the handover of your responsibilities before that date.',
            height: 58,
          },
        ],
        terms: {
          heading: 'Before your last day',
          items: [
            'Complete the handover checklist and return all company property.',
            'Full and final settlement will be processed by {{resignation.settlement_date}}.',
            'Your experience and relieving letters will be issued on your last working day.',
            'Confidentiality obligations under your appointment continue after employment ends.',
          ],
        },
        closing:
          'Thank you for your contribution over the past {{resignation.tenure}}. We wish you well in your next role.\n\nYours sincerely,',
        footer: '{{company.name}} · {{company.address}} · {{company.contact}}',
      }),
    values: {
      'company.name': 'Northwind Traders Pvt Ltd',
      'company.address': '4th Floor, Prestige Corner, MG Road, Bengaluru 560001',
      'company.contact': 'people@northwind.example · +91 80 4123 7788',
      'letter.reference': 'NW/HR/2026/0259',
      'letter.date': '17 August 2026',
      'recipient.name': 'Mr Vikram Iyer',
      'recipient.first_name': 'Vikram',
      'recipient.address': '32 Brigade Gardens, Koramangala\nBengaluru, Karnataka 560034',
      'job.title': 'Logistics Coordinator',
      'job.department': 'Supply Chain',
      'resignation.received_date': '12 August 2026',
      'resignation.last_working_day': '11 October 2026',
      'resignation.handover_to': 'Sneha Kulkarni',
      'resignation.settlement_date': '10 November 2026',
      'resignation.tenure': 'four years',
      'signatory.name': 'Devika Menon',
      'signatory.title': 'Head of People, Northwind Traders Pvt Ltd',
    },
  },

  {
    slug: 'free-warning-letter-template',
    category: 'HR',
    name: 'Warning Letter',
    build: () =>
      formalLetter({
        title: 'WARNING',
        meta: [
          ['Reference', '{{letter.reference}}'],
          ['Date', '{{letter.date}}'],
        ],
        subject: 'Subject: Written warning — {{warning.matter}}',
        salutation: 'Dear {{recipient.first_name}},',
        paragraphs: [
          {
            body: 'This letter is a formal written warning regarding {{warning.matter}}. The concern was discussed with you on {{warning.discussed_date}} by {{warning.raised_by}}, and this letter records the outcome of that discussion.',
            height: 58,
          },
          {
            body: 'Specifically: {{warning.detail}} This does not meet the standard expected of your role and is inconsistent with the terms of your appointment.',
            height: 50,
          },
        ],
        terms: {
          heading: 'What we expect now',
          items: [
            'Improvement is expected with immediate effect and will be reviewed on {{warning.review_date}}.',
            'Your manager will meet you fortnightly until that review.',
            'Support is available through {{warning.support}} if anything is affecting your work.',
            'Further instances may lead to disciplinary action up to termination of employment.',
          ],
        },
        closing:
          'You may respond in writing within seven days if you wish your comments recorded alongside this letter. Please sign and return the enclosed copy as acknowledgement of receipt.\n\nYours sincerely,',
        footer: 'A copy of this letter will be placed on your personnel file.',
      }),
    values: {
      'company.name': 'Northwind Traders Pvt Ltd',
      'company.address': '4th Floor, Prestige Corner, MG Road, Bengaluru 560001',
      'company.contact': 'people@northwind.example · +91 80 4123 7788',
      'letter.reference': 'NW/HR/2026/0261',
      'letter.date': '17 August 2026',
      'recipient.name': 'Mr Sameer Joshi',
      'recipient.first_name': 'Sameer',
      'recipient.address': '9 Palm Grove, Whitefield\nBengaluru, Karnataka 560066',
      'warning.matter': 'repeated unreported absence',
      'warning.discussed_date': '11 August 2026',
      'warning.raised_by': 'your reporting manager',
      'warning.detail':
        'you were absent on 28 and 29 July and on 5 August without notifying your manager in advance or submitting leave requests afterwards.',
      'warning.review_date': '30 September 2026',
      'warning.support': 'the employee assistance programme',
      'signatory.name': 'Devika Menon',
      'signatory.title': 'Head of People, Northwind Traders Pvt Ltd',
    },
  },

  {
    slug: 'free-promotion-letter-template',
    category: 'HR',
    name: 'Promotion Letter',
    build: () =>
      formalLetter({
        title: 'PROMOTION',
        meta: [
          ['Reference', '{{letter.reference}}'],
          ['Date', '{{letter.date}}'],
        ],
        subject: 'Subject: Promotion to {{promotion.new_title}}',
        salutation: 'Dear {{recipient.first_name}},',
        paragraphs: [
          {
            body: 'It is a pleasure to confirm your promotion from {{promotion.old_title}} to {{promotion.new_title}}, effective {{promotion.effective_date}}. The decision reflects the quality of your work over the past year and the responsibility you have taken on beyond your current role.',
            height: 58,
          },
          {
            body: 'In the new role you will report to {{promotion.reporting_to}} and take ownership of {{promotion.scope}}. Your revised terms are set out below; all other terms of your appointment are unchanged.',
            height: 58,
          },
        ],
        terms: {
          heading: 'Revised terms',
          items: [
            'Revised annual cost to company: {{promotion.new_ctc}}, effective {{promotion.effective_date}}.',
            'Reporting line: {{promotion.reporting_to}}.',
            'Notice period: {{promotion.notice_period}}.',
            'Next review: {{promotion.next_review}}.',
          ],
        },
        closing:
          'Congratulations on a well-earned step forward. Please sign and return the enclosed copy.\n\nYours sincerely,',
        footer: '{{company.name}} · {{company.address}} · {{company.contact}}',
      }),
    values: {
      'company.name': 'Northwind Traders Pvt Ltd',
      'company.address': '4th Floor, Prestige Corner, MG Road, Bengaluru 560001',
      'company.contact': 'people@northwind.example · +91 80 4123 7788',
      'letter.reference': 'NW/HR/2026/0266',
      'letter.date': '17 August 2026',
      'recipient.name': 'Ms Sneha Kulkarni',
      'recipient.first_name': 'Sneha',
      'recipient.address': '44 Jubilee Residency, HSR Layout\nBengaluru, Karnataka 560102',
      'promotion.old_title': 'Analytics Lead',
      'promotion.new_title': 'Head of Analytics',
      'promotion.effective_date': '01 September 2026',
      'promotion.reporting_to': 'the Chief Operating Officer',
      'promotion.scope': 'the analytics function across supply chain and sales',
      'promotion.new_ctc': '₹32,00,000 per annum',
      'promotion.notice_period': 'Three months',
      'promotion.next_review': 'April 2027',
      'signatory.name': 'Devika Menon',
      'signatory.title': 'Head of People, Northwind Traders Pvt Ltd',
    },
  },

  {
    slug: 'free-timesheet-template',
    category: 'HR',
    name: 'Timesheet',
    build: () =>
      tabularRecord({
        title: 'TIMESHEET',
        accent: ACCENT.HR,
        meta: [
          ['Week ending', '{{timesheet.week_ending}}'],
          ['Sheet no.', '{{timesheet.number}}'],
          ['Status', '{{timesheet.status}}'],
        ],
        details: [
          ['Employee', '{{employee.name}}'],
          ['Employee ID', '{{employee.id}}'],
          ['Department', '{{employee.department}}'],
          ['Manager', '{{timesheet.manager}}'],
          ['Contract hours', '{{timesheet.contract_hours}}'],
          ['Cost centre', '{{timesheet.cost_centre}}'],
        ],
        sections: [
          {
            heading: 'Hours worked',
            columns: [
              { header: 'Date', key: 'date' },
              { header: 'Project / task', key: 'task' },
              { header: 'Hours', key: 'hours' },
            ],
            columnWidths: [1.1, 3, 0.8],
            dataKey: 'entries',
            rows: 5,
            height: 118,
          },
          {
            heading: 'Leave and absence',
            columns: [
              { header: 'Date', key: 'date' },
              { header: 'Type', key: 'type' },
              { header: 'Hours', key: 'hours' },
            ],
            columnWidths: [1.1, 3, 0.8],
            dataKey: 'absence',
            rows: 2,
            height: 64,
          },
        ],
        totals: [
          { label: 'Hours worked', value: '{{totals.worked}}' },
          { label: 'Leave and absence', value: '{{totals.absence}}' },
          { label: 'Total accounted', value: '{{totals.net}}', strong: true },
        ],
        footer: 'Submit by Monday 12pm. Approved timesheets feed the payroll run for that month.',
      }),
    values: {
      'company.name': 'Northwind Traders Pvt Ltd',
      'company.address': '4th Floor, Prestige Corner, MG Road, Bengaluru 560001',
      'company.contact': 'payroll@northwind.example · +91 80 4123 7788',
      'timesheet.week_ending': 'Sunday, 16 August 2026',
      'timesheet.number': 'TS-2026-W33-0412',
      'timesheet.status': 'Submitted, awaiting approval',
      'timesheet.manager': 'Sneha Kulkarni',
      'timesheet.contract_hours': '40.0 per week',
      'timesheet.cost_centre': 'Operations — Bengaluru',
      'employee.name': 'Rahul Sharma',
      'employee.id': 'NW-2291',
      'employee.department': 'Warehouse Operations',
      'totals.worked': '32.0 hrs',
      'totals.absence': '8.0 hrs',
      'totals.net': '40.0 hrs',
      'signatory.name': 'Sneha Kulkarni',
      'signatory.title': 'Reporting Manager',
      entries: rows([
        { date: 'Mon 10 Aug', task: 'Inbound goods receipting', hours: '8.0' },
        { date: 'Tue 11 Aug', task: 'Cycle count — aisles 3 to 7', hours: '8.0' },
        { date: 'Wed 12 Aug', task: 'Dispatch — south region orders', hours: '8.0' },
        { date: 'Thu 13 Aug', task: 'Stock reconciliation with finance', hours: '8.0' },
        { date: 'Fri 14 Aug', task: 'Annual leave', hours: '0.0' },
      ]),
      absence: rows([
        { date: 'Fri 14 Aug', type: 'Annual leave — approved', hours: '8.0' },
        { date: '—', type: 'Sick leave', hours: '0.0' },
      ]),
    },
  },

  // ── Education ──────────────────────────────────────────────────────────────

  {
    slug: 'free-bonafide-certificate-template',
    category: 'Education',
    name: 'Bonafide Certificate',
    build: () =>
      formalLetter({
        title: 'BONAFIDE',
        meta: [
          ['Reference', '{{letter.reference}}'],
          ['Date', '{{letter.date}}'],
        ],
        subject: 'To whom it may concern',
        salutation: '',
        paragraphs: [
          {
            body: 'This is to certify that {{student.name}}, {{student.relation}} {{student.guardian}}, is a bonafide student of {{company.name}}, enrolled in {{student.programme}} under registration number {{student.registration}}.',
            height: 58,
          },
          {
            body: 'The student is currently studying in {{student.year}} for the academic year {{student.academic_year}}. Conduct during the period of study has been satisfactory.',
            height: 50,
          },
        ],
        terms: {
          heading: 'Certificate details',
          items: [
            'Date of admission: {{student.admission_date}}.',
            'Programme: {{student.programme}}, {{student.duration}}.',
            'Date of birth as per records: {{student.dob}}.',
            'Issued at the request of the student for {{letter.purpose}}.',
          ],
        },
        closing:
          'This certificate is issued for official purposes and is valid for {{letter.validity}} from the date of issue.\n\nYours faithfully,',
        footer: '{{company.name}} · {{company.address}} · {{company.contact}}',
      }),
    values: {
      'company.name': 'Meridian Institute of Technology',
      'company.address': 'Survey 118, Hinjewadi Phase II, Pune 411057',
      'company.contact': 'registrar@meridian.example · +91 20 6612 3300',
      'letter.reference': 'MIT/REG/BC/2026/0834',
      'letter.date': '17 August 2026',
      'letter.purpose': 'a passport application',
      'letter.validity': 'six months',
      'recipient.name': 'Ms Kavya Ramesh',
      'recipient.address': '12 Sunrise Colony, Aundh\nPune, Maharashtra 411007',
      'student.name': 'Kavya Ramesh',
      'student.relation': 'daughter of',
      'student.guardian': 'Mr R. Ramesh',
      'student.programme': 'B.Tech in Computer Science and Engineering',
      'student.registration': 'MIT/CSE/2023/0416',
      'student.year': 'the sixth semester, third year',
      'student.academic_year': '2026–27',
      'student.admission_date': '01 August 2023',
      'student.duration': 'four years, full time',
      'student.dob': '14 March 2005',
      'signatory.name': 'Dr S. Venkataraman',
      'signatory.title': 'Registrar, Meridian Institute of Technology',
    },
  },

  {
    slug: 'free-transfer-certificate-template',
    category: 'Education',
    name: 'Transfer Certificate',
    build: () =>
      formalLetter({
        title: 'TRANSFER',
        meta: [
          ['TC no.', '{{letter.reference}}'],
          ['Date', '{{letter.date}}'],
        ],
        subject: 'Transfer Certificate',
        salutation: '',
        paragraphs: [
          {
            body: 'This is to certify that {{student.name}}, {{student.relation}} {{student.guardian}}, was a student of {{company.name}} under registration number {{student.registration}}, and has been granted a transfer certificate on leaving the institution.',
            height: 58,
          },
          {
            body: 'The student was admitted on {{student.admission_date}} and left on {{student.leaving_date}}, having completed {{student.completed}}. No dues remain outstanding against the student’s account.',
            height: 58,
          },
        ],
        terms: {
          heading: 'Record of the student',
          items: [
            'Date of birth as per records: {{student.dob}}.',
            'Last class studied: {{student.last_class}}, academic year {{student.academic_year}}.',
            'Conduct and character: {{student.conduct}}.',
            'Reason for leaving: {{student.reason}}.',
            'Whether qualified for promotion: {{student.promotion}}.',
          ],
        },
        closing:
          'This certificate is issued on the written application of the parent or guardian and supersedes no other record.\n\nYours faithfully,',
        footer: 'Alterations to this certificate render it invalid. Duplicates are issued only on written request.',
      }),
    values: {
      'company.name': 'Meridian Institute of Technology',
      'company.address': 'Survey 118, Hinjewadi Phase II, Pune 411057',
      'company.contact': 'registrar@meridian.example · +91 20 6612 3300',
      'letter.reference': 'MIT/TC/2026/0219',
      'letter.date': '17 August 2026',
      'recipient.name': 'Mr Arjun Deshpande',
      'recipient.address': '7 Riverside Enclave, Baner\nPune, Maharashtra 411045',
      'student.name': 'Arjun Deshpande',
      'student.relation': 'son of',
      'student.guardian': 'Mr M. Deshpande',
      'student.registration': 'MIT/CSE/2022/0288',
      'student.admission_date': '02 August 2022',
      'student.leaving_date': '31 July 2026',
      'student.completed': 'the full four-year programme',
      'student.dob': '09 November 2004',
      'student.last_class': 'B.Tech, eighth semester',
      'student.academic_year': '2025–26',
      'student.conduct': 'Good throughout the period of study',
      'student.reason': 'Completion of the programme',
      'student.promotion': 'Yes — passed and eligible for the award of the degree',
      'signatory.name': 'Dr S. Venkataraman',
      'signatory.title': 'Registrar, Meridian Institute of Technology',
    },
  },

  {
    slug: 'free-character-certificate-template',
    category: 'Education',
    name: 'Character Certificate',
    build: () =>
      certificate({
        heading: 'Character Certificate',
        subheading: 'This is to certify that',
        body: 'was a student of {{institution.name}} from {{student.start_date}} to {{student.end_date}}, enrolled in {{student.programme}}. During this period conduct and character were found to be {{student.character}}, and no disciplinary action was recorded against the student.',
        detailStrip: [
          ['Registration', '{{student.registration}}'],
          ['Programme', '{{student.programme_short}}'],
          ['Issued', '{{certificate.date}}'],
        ],
      }),
    values: {
      'institution.name': 'Meridian Institute of Technology',
      'institution.tagline': 'Office of the Registrar',
      'recipient.name': 'Kavya Ramesh',
      'student.start_date': '01 August 2023',
      'student.end_date': '31 July 2026',
      'student.programme': 'B.Tech in Computer Science and Engineering',
      'student.programme_short': 'B.Tech CSE',
      'student.registration': 'MIT/CSE/2023/0416',
      'student.character': 'exemplary',
      'certificate.date': '17 August 2026',
      'certificate.number': 'MIT/CC/2026/0451',
      'signatory.name': 'Dr S. Venkataraman',
      'signatory.title': 'Registrar',
      'cosignatory.name': 'Prof. Leela Iyer',
      'cosignatory.title': 'Dean of Students',
    },
  },

  {
    slug: 'free-attendance-register-template',
    category: 'Education',
    name: 'Attendance Register',
    build: () =>
      tabularRecord({
        title: 'ATTENDANCE REGISTER',
        accent: ACCENT.Education,
        varPrefix: 'institution',
        meta: [
          ['Month', '{{register.month}}'],
          ['Class', '{{register.class}}'],
          ['Register no.', '{{register.number}}'],
        ],
        details: [
          ['Subject', '{{register.subject}}'],
          ['Faculty', '{{register.faculty}}'],
          ['Sessions held', '{{register.sessions_held}}'],
          ['Minimum required', '{{register.minimum}}'],
          ['Semester', '{{register.semester}}'],
          ['Academic year', '{{register.academic_year}}'],
        ],
        sections: [
          {
            heading: 'Student attendance',
            columns: [
              { header: 'Roll no.', key: 'roll' },
              { header: 'Student name', key: 'name' },
              { header: 'Present', key: 'present' },
              { header: '%', key: 'percent' },
            ],
            columnWidths: [1, 3, 0.9, 0.8],
            dataKey: 'students',
            rows: 6,
            height: 140,
          },
        ],
        totals: [
          { label: 'Students on roll', value: '{{totals.on_roll}}' },
          { label: 'Meeting the minimum', value: '{{totals.eligible}}' },
          { label: 'Class average', value: '{{totals.average}}', strong: true },
        ],
        footer: 'Students below the minimum attendance are not eligible to sit the end-semester examination.',
      }),
    values: {
      'institution.name': 'Meridian Institute of Technology',
      'institution.address': 'Survey 118, Hinjewadi Phase II, Pune 411057',
      'institution.contact': 'registrar@meridian.example · +91 20 6612 3300',
      'register.month': 'July 2026',
      'register.class': 'B.Tech CSE — Section A',
      'register.number': 'MIT/ATT/2026/S6-A',
      'register.subject': 'Applied Data Analysis (CS-604)',
      'register.faculty': 'Prof. Leela Iyer',
      'register.sessions_held': '24',
      'register.minimum': '75%',
      'register.semester': 'Sixth',
      'register.academic_year': '2026–27',
      'totals.on_roll': '6',
      'totals.eligible': '5',
      'totals.average': '84.7%',
      'signatory.name': 'Prof. Leela Iyer',
      'signatory.title': 'Subject Faculty',
      students: rows([
        { roll: 'CSE-041', name: 'Kavya Ramesh', present: '23', percent: '95.8' },
        { roll: 'CSE-042', name: 'Arjun Deshpande', present: '21', percent: '87.5' },
        { roll: 'CSE-043', name: 'Nikhil Menon', present: '22', percent: '91.7' },
        { roll: 'CSE-044', name: 'Sara Qureshi', present: '20', percent: '83.3' },
        { roll: 'CSE-045', name: 'Tanvi Bhatt', present: '19', percent: '79.2' },
        { roll: 'CSE-046', name: 'Rohan Pillai', present: '17', percent: '70.8' },
      ]),
    },
  },

  {
    slug: 'free-fee-receipt-template',
    category: 'Education',
    name: 'Fee Receipt',
    build: () =>
      financialDoc({
        title: 'FEE RECEIPT',
        meta: [
          ['Receipt no.', '{{receipt.number}}'],
          ['Receipt date', '{{receipt.date}}'],
          ['Academic year', '{{receipt.academic_year}}'],
        ],
        partyHeading: 'Received from',
        partyLines: ['{{student.name}}', '{{student.programme}}'],
        strip: [
          ['Registration', '{{student.registration}}'],
          ['Payment method', '{{payment.method}}'],
          ['Reference', '{{payment.reference}}'],
        ],
        columns: [
          { header: 'Fee head', key: 'description' },
          { header: 'Term', key: 'term' },
          { header: 'Amount', key: 'amount' },
        ],
        columnWidths: [3, 1.2, 1.1],
        dataKey: 'line_items',
        rows: 5,
        totals: [
          { label: 'Total fees', value: '{{totals.subtotal}}' },
          { label: 'Scholarship applied', value: '{{totals.discount}}' },
          { label: 'Amount received', value: '{{totals.grand_total}}', strong: true },
        ],
        amountInWords: '{{totals.in_words}}',
        notes: {
          heading: 'Balance and next instalment',
          body: '{{receipt.balance_note}}',
        },
        signName: '{{signatory.name}}',
        signRole: 'For {{company.name}}',
        footer: 'Retain this receipt. It is required for fee-related queries and for income-tax purposes.',
      }),
    values: {
      'company.name': 'Meridian Institute of Technology',
      'company.address': 'Survey 118, Hinjewadi Phase II, Pune 411057',
      'company.contact': 'accounts@meridian.example · +91 20 6612 3300',
      'receipt.number': 'MIT/FEE/2026/11842',
      'receipt.date': '17 Aug 2026',
      'receipt.academic_year': '2026–27',
      'student.name': 'Kavya Ramesh',
      'student.programme': 'B.Tech CSE — Sixth semester',
      'student.registration': 'MIT/CSE/2023/0416',
      'payment.method': 'Net banking',
      'payment.reference': 'UTR 6621480093117',
      'totals.subtotal': '₹1,42,000.00',
      'totals.discount': '−₹20,000.00',
      'totals.grand_total': '₹1,22,000.00',
      'totals.in_words': 'One lakh twenty-two thousand rupees only',
      'receipt.balance_note':
        'Balance outstanding for the academic year: ₹0.00\nNext instalment falls due on 05 January 2027.',
      'signatory.name': 'Meena Iyer',
      line_items: rows([
        { description: 'Tuition fee', term: 'Semester 6', amount: '₹98,000.00' },
        { description: 'Laboratory and equipment', term: 'Semester 6', amount: '₹18,000.00' },
        { description: 'Library and digital resources', term: 'Annual', amount: '₹12,000.00' },
        { description: 'Examination fee', term: 'Semester 6', amount: '₹8,000.00' },
        { description: 'Student activities', term: 'Annual', amount: '₹6,000.00' },
      ]),
    },
  },

  // ── Business ───────────────────────────────────────────────────────────────

  {
    slug: 'free-meeting-minutes-template',
    category: 'Business',
    name: 'Meeting Minutes',
    build: () =>
      longFormDoc({
        title: 'Minutes of Meeting',
        subtitle: 'A record of what was discussed, what was decided, and who owns each action.',
        accent: ACCENT.Business,
        meta: [
          ['Meeting', '{{meeting.title}}'],
          ['Date and time', '{{meeting.datetime}}'],
          ['Location', '{{meeting.location}}'],
          ['Chair', '{{meeting.chair}}'],
        ],
        parties: [
          { heading: 'Present', lines: ['{{meeting.present}}'] },
          { heading: 'Apologies', lines: ['{{meeting.apologies}}'] },
        ],
        intro:
          'The chair opened the meeting at {{meeting.start_time}} and confirmed a quorum. The minutes of the previous meeting held on {{meeting.previous_date}} were approved without amendment.',
        sections: [
          {
            heading: '1. Matters arising',
            body: '{{meeting.matters_arising}}',
            height: 46,
          },
          {
            heading: '2. Decisions taken',
            items: [
              '{{meeting.decision_one}}',
              '{{meeting.decision_two}}',
              '{{meeting.decision_three}}',
            ],
          },
          {
            heading: '3. Actions and owners',
            items: [
              '{{meeting.action_one}}',
              '{{meeting.action_two}}',
              '{{meeting.action_three}}',
            ],
          },
          {
            heading: '4. Next meeting',
            body: 'The next meeting is scheduled for {{meeting.next_date}} at {{meeting.next_location}}. The chair closed the meeting at {{meeting.end_time}}.',
            height: 40,
          },
        ],
        signatures: false,
        footer: 'Circulated to all attendees. Corrections should be raised before the next meeting.',
      }),
    values: {
      'company.name': 'Northwind Traders Pvt Ltd',
      'meeting.title': 'Operations review — Q3',
      'meeting.datetime': '14 August 2026, 10.00am',
      'meeting.location': 'Boardroom, MG Road office',
      'meeting.chair': 'Devika Menon, Chief Operating Officer',
      'meeting.present':
        'Devika Menon (chair), Ananya Rao, Sneha Kulkarni, Rahul Sharma, Vikram Iyer',
      'meeting.apologies': 'Meena Iyer (annual leave)',
      'meeting.start_time': '10.02am',
      'meeting.end_time': '11.15am',
      'meeting.previous_date': '10 July 2026',
      'meeting.matters_arising':
        'The warehouse racking installation, carried over from the previous meeting, is complete and signed off. The delayed supplier audit has been rescheduled to September.',
      'meeting.decision_one':
        'Approved the revised freight rates with effect from 01 September 2026.',
      'meeting.decision_two':
        'Agreed to extend the Hyderabad pilot by one quarter before deciding on a wider rollout.',
      'meeting.decision_three':
        'Deferred the ERP upgrade to the next financial year on cost grounds.',
      'meeting.action_one':
        'Ananya Rao to circulate the revised rate card to customers by 25 August.',
      'meeting.action_two':
        'Sneha Kulkarni to report on pilot metrics at the October meeting.',
      'meeting.action_three':
        'Rahul Sharma to complete the supplier audit checklist before 15 September.',
      'meeting.next_date': '11 September 2026, 10.00am',
      'meeting.next_location': 'the MG Road boardroom',
    },
  },

  {
    slug: 'free-sow-template',
    category: 'Business',
    name: 'SOW',
    build: () =>
      longFormDoc({
        title: 'Statement of Work',
        subtitle: 'The scope, deliverables, timeline and commercial terms for a defined piece of work.',
        accent: ACCENT.Business,
        meta: [
          ['SOW no.', '{{sow.number}}'],
          ['Effective date', '{{sow.effective_date}}'],
          ['Under agreement', '{{sow.master_agreement}}'],
          ['Duration', '{{sow.duration}}'],
        ],
        parties: [
          {
            heading: 'Supplier',
            lines: ['{{party_one.name}}', '{{party_one.address}}', '{{party_one.registration}}'],
          },
          {
            heading: 'Client',
            lines: ['{{party_two.name}}', '{{party_two.address}}', '{{party_two.registration}}'],
          },
        ],
        intro:
          'This statement of work is issued under the master services agreement referenced above and describes {{sow.summary}}. Where this document and the master agreement conflict, the master agreement prevails except on scope and fees.',
        sections: [
          {
            heading: '1. Scope of work',
            body: '{{sow.scope}}',
            height: 46,
          },
          {
            heading: '2. Deliverables and acceptance',
            items: [
              '{{sow.deliverable_one}}',
              '{{sow.deliverable_two}}',
              '{{sow.deliverable_three}}',
              'Each deliverable is deemed accepted {{sow.acceptance_window}} after submission unless rejected in writing with reasons.',
            ],
          },
          {
            heading: '3. Fees and invoicing',
            body: 'Total fees are {{sow.fees}}, invoiced {{sow.invoice_schedule}}. Payment terms are {{sow.payment_terms}}. Expenses require prior written approval and are charged at cost.',
            height: 46,
          },
          {
            heading: '4. Out of scope',
            body: '{{sow.out_of_scope}}',
            height: 40,
          },
        ],
        footer: 'Changes to scope require a written change order signed by both parties.',
      }),
    values: {
      'sow.number': 'SOW-2026-0014',
      'sow.effective_date': '01 September 2026',
      'sow.master_agreement': 'MSA-2025-0007',
      'sow.duration': '14 weeks',
      'sow.summary': 'a warehouse automation assessment and implementation plan',
      'sow.scope':
        'The supplier will assess current warehouse operations across two sites, model three automation options, and produce an implementation plan with costs, sequencing and risks. Work includes site visits, stakeholder interviews and a final presentation to the leadership team.',
      'sow.deliverable_one': 'Current-state assessment report, week 4.',
      'sow.deliverable_two': 'Options model with costed scenarios, week 9.',
      'sow.deliverable_three': 'Implementation plan and final presentation, week 14.',
      'sow.acceptance_window': 'ten working days',
      'sow.fees': '₹24,00,000 excluding taxes',
      'sow.invoice_schedule': 'in three instalments on acceptance of each deliverable',
      'sow.payment_terms': 'net 30 days from invoice date',
      'sow.out_of_scope':
        'Software licensing, hardware procurement, and any work at sites other than the two named above. These may be added by change order.',
      'party_one.name': 'Meridian Advisory LLP',
      'party_one.address': 'Level 6, Cyber Towers, Hitec City, Hyderabad 500081',
      'party_one.registration': 'LLPIN AAB-4471',
      'party_one.signatory': 'K. Subramanian, Partner',
      'party_two.name': 'Northwind Traders Pvt Ltd',
      'party_two.address': '4th Floor, Prestige Corner, MG Road, Bengaluru 560001',
      'party_two.registration': 'CIN U51909KA2015PTC081234',
      'party_two.signatory': 'Devika Menon, Chief Operating Officer',
    },
  },

  {
    slug: 'free-business-plan-template',
    category: 'Business',
    name: 'Business Plan',
    build: () =>
      longFormDoc({
        title: 'Business Plan',
        subtitle: 'A summary of the business, the market it serves, and how it intends to grow.',
        accent: ACCENT.Business,
        meta: [
          ['Business', '{{plan.business_name}}'],
          ['Prepared', '{{plan.date}}'],
          ['Planning horizon', '{{plan.horizon}}'],
          ['Prepared by', '{{plan.author}}'],
        ],
        parties: [
          {
            heading: 'Registered office',
            lines: ['{{plan.business_name}}', '{{plan.address}}', '{{plan.registration}}'],
          },
          { heading: 'Contact', lines: ['{{plan.contact_name}}', '{{plan.contact}}'] },
        ],
        intro:
          '{{plan.executive_summary}}',
        sections: [
          {
            heading: '1. The opportunity',
            body: '{{plan.opportunity}}',
            height: 46,
          },
          {
            heading: '2. Products and services',
            items: [
              '{{plan.offer_one}}',
              '{{plan.offer_two}}',
              '{{plan.offer_three}}',
            ],
          },
          {
            heading: '3. Market and competition',
            body: '{{plan.market}}',
            height: 46,
          },
          {
            heading: '4. Financial outline',
            items: [
              'Revenue target, year one: {{plan.revenue_y1}}.',
              'Gross margin, steady state: {{plan.margin}}.',
              'Funding sought: {{plan.funding}}, applied to {{plan.funding_use}}.',
              'Break-even expected: {{plan.breakeven}}.',
            ],
          },
        ],
        signatures: false,
        footer: 'Figures are projections prepared in good faith and are not a guarantee of performance.',
      }),
    values: {
      'plan.business_name': 'Northwind Traders Pvt Ltd',
      'plan.date': '17 August 2026',
      'plan.horizon': 'Three years, FY27–FY29',
      'plan.author': 'Devika Menon, Chief Operating Officer',
      'plan.address': '4th Floor, Prestige Corner, MG Road, Bengaluru 560001',
      'plan.registration': 'CIN U51909KA2015PTC081234',
      'plan.contact_name': 'Devika Menon',
      'plan.contact': 'devika@northwind.example · +91 80 4123 7788',
      'plan.executive_summary':
        'Northwind supplies industrial storage and workspace fittings to mid-sized manufacturers in south India. The business is profitable at ₹18 crore of revenue and plans to reach ₹34 crore in three years.',
      'plan.opportunity':
        'Manufacturers increasingly want fitting-out handled end to end rather than buying components and arranging installation separately. Few regional suppliers offer both, and national players quote at a premium mid-sized buyers resist.',
      'plan.offer_one': 'Industrial storage systems — racking, shelving and mezzanine structures.',
      'plan.offer_two': 'Workspace fittings — benches, tool systems and safety enclosures.',
      'plan.offer_three': 'Design, installation and annual maintenance as a bundled service.',
      'plan.market':
        'The addressable market across Karnataka, Telangana and Tamil Nadu is roughly ₹1,900 crore, growing at 9% a year. Competition is fragmented and largely price-led.',
      'plan.revenue_y1': '₹22 crore',
      'plan.margin': '31%',
      'plan.funding': '₹4.5 crore',
      'plan.funding_use': 'working capital and the Hyderabad warehouse',
      'plan.breakeven': 'Month 14 on the new territories',
    },
  },

  {
    slug: 'free-price-list-template',
    category: 'Business',
    name: 'Price List',
    build: () =>
      financialDoc({
        title: 'PRICE LIST',
        meta: [
          ['List no.', '{{list.number}}'],
          ['Effective from', '{{list.effective_from}}'],
          ['Supersedes', '{{list.supersedes}}'],
        ],
        partyHeading: 'Prepared for',
        partyLines: CUSTOMER.slice(0, 2),
        strip: [
          ['Currency', '{{list.currency}}'],
          ['Prices include', '{{list.includes}}'],
          ['Valid until', '{{list.valid_until}}'],
        ],
        columns: [
          { header: 'Item', key: 'description' },
          { header: 'Code', key: 'code' },
          { header: 'Unit', key: 'unit' },
          { header: 'Price', key: 'price' },
        ],
        columnWidths: [3, 1, 0.9, 1.1],
        dataKey: 'line_items',
        rows: 6,
        totals: [
          { label: 'Items listed', value: '{{totals.count}}' },
          { label: 'Volume discount', value: '{{totals.discount}}', strong: true },
        ],
        notes: {
          heading: 'Terms',
          body: '{{list.terms}}',
        },
        signName: '{{signatory.name}}',
        signRole: 'For {{company.name}}',
        footer: 'Prices are subject to change with 30 days’ notice. Freight quoted separately.',
      }),
    values: {
      ...COMPANY,
      ...CUSTOMER_VALUES,
      'list.number': 'PL-2026-H2',
      'list.effective_from': '01 Sep 2026',
      'list.supersedes': 'PL-2026-H1',
      'list.currency': 'INR (₹)',
      'list.includes': 'GST at 18%',
      'list.valid_until': '28 Feb 2027',
      'totals.count': '6 items',
      'totals.discount': '5% above ₹5,00,000',
      'list.terms':
        'Minimum order value ₹25,000. Lead time 3–4 weeks from confirmed order.\nInstallation quoted per site and is not included in the unit prices above.',
      'signatory.name': 'Ananya Rao',
      line_items: rows([
        { description: 'Industrial shelving unit — 1800mm', code: 'SH-1800', unit: 'each', price: '₹7,400.00' },
        { description: 'Industrial shelving unit — 2400mm', code: 'SH-2400', unit: 'each', price: '₹9,800.00' },
        { description: 'Workbench with vice — 1800mm', code: 'WB-1800', unit: 'each', price: '₹11,500.00' },
        { description: 'Tool wall system — 2m run', code: 'TW-2000', unit: 'run', price: '₹6,200.00' },
        { description: 'Safety enclosure panel', code: 'SE-P01', unit: 'panel', price: '₹3,900.00' },
        { description: 'Mezzanine decking', code: 'MZ-DK', unit: 'sq m', price: '₹2,150.00' },
      ]),
    },
  },

  {
    slug: 'free-packing-list-template',
    category: 'Business',
    name: 'Packing List',
    build: () =>
      financialDoc({
        title: 'PACKING LIST',
        meta: [
          ['Packing list no.', '{{packing.number}}'],
          ['Date', '{{packing.date}}'],
          ['Invoice ref.', '{{packing.invoice_reference}}'],
        ],
        partyHeading: 'Consignee',
        partyLines: CUSTOMER.slice(0, 2),
        secondParty: {
          heading: 'Deliver to',
          lines: ['{{shipping.name}}', '{{shipping.address}}'],
        },
        strip: [
          ['Total cartons', '{{packing.cartons}}'],
          ['Gross weight', '{{packing.gross_weight}}'],
          ['Dimensions', '{{packing.dimensions}}'],
        ],
        columns: [
          { header: 'Contents', key: 'description' },
          { header: 'Carton', key: 'carton' },
          { header: 'Qty', key: 'qty' },
          { header: 'Weight', key: 'weight' },
        ],
        columnWidths: [3, 1, 0.7, 1],
        dataKey: 'line_items',
        rows: 5,
        totals: [
          { label: 'Cartons', value: '{{packing.cartons}}' },
          { label: 'Net weight', value: '{{packing.net_weight}}' },
          { label: 'Gross weight', value: '{{packing.gross_weight}}', strong: true },
        ],
        notes: {
          heading: 'Handling',
          body: '{{packing.handling}}',
        },
        signName: '{{signatory.name}}',
        signRole: 'Packed and checked by',
        footer: 'Check contents against this list on delivery. Report shortages within 48 hours.',
      }),
    values: {
      ...COMPANY,
      ...CUSTOMER_VALUES,
      'packing.number': 'PKL-2026-0298',
      'packing.date': '17 Aug 2026',
      'packing.invoice_reference': 'INV-2026-0184',
      'packing.cartons': '14',
      'packing.gross_weight': '486 kg',
      'packing.net_weight': '452 kg',
      'packing.dimensions': '4 pallets, 1.2 × 1.0 × 1.6 m',
      'shipping.name': 'Halcyon Design Studio — Warehouse',
      'shipping.address': 'Warehouse 3, Hosur Road, Bengaluru 560068',
      'packing.handling':
        'Keep dry. Do not stack pallets more than two high.\nCartons 11 to 14 contain glass panels and are marked fragile.',
      'signatory.name': 'Rahul Sharma',
      line_items: rows([
        { description: 'Shelving uprights — 2400mm', carton: '1–4', qty: '40', weight: '184 kg' },
        { description: 'Shelf beams and decking', carton: '5–8', qty: '120', weight: '156 kg' },
        { description: 'Fixing kits and anchors', carton: '9', qty: '20', weight: '38 kg' },
        { description: 'Assembly tool sets', carton: '10', qty: '2', weight: '14 kg' },
        { description: 'Safety enclosure panels', carton: '11–14', qty: '8', weight: '60 kg' },
      ]),
    },
  },

  {
    slug: 'free-letterhead-template',
    category: 'Business',
    name: 'Letterhead',
    build: () =>
      formalLetter({
        title: 'LETTER',
        meta: [
          ['Reference', '{{letter.reference}}'],
          ['Date', '{{letter.date}}'],
        ],
        subject: 'Subject: {{letter.subject}}',
        salutation: 'Dear {{recipient.first_name}},',
        paragraphs: [
          {
            body: '{{letter.opening}}',
            height: 58,
          },
          {
            body: '{{letter.body}}',
            height: 66,
          },
        ],
        terms: {
          heading: 'Enclosures',
          items: [
            '{{letter.enclosure_one}}',
            '{{letter.enclosure_two}}',
          ],
        },
        closing: '{{letter.closing}}\n\nYours sincerely,',
        footer: '{{company.name}} · {{company.address}} · {{company.contact}}',
      }),
    values: {
      'company.name': 'Northwind Traders Pvt Ltd',
      'company.address': '4th Floor, Prestige Corner, MG Road, Bengaluru 560001',
      'company.contact': 'hello@northwind.example · +91 80 4123 7788 · northwind.example',
      'letter.reference': 'NW/GEN/2026/0142',
      'letter.date': '17 August 2026',
      'letter.subject': 'Replace this with what the letter is about',
      'recipient.name': 'Ms Halcyon Recipient',
      'recipient.first_name': 'Halcyon',
      'recipient.address': '22 Residency Road\nBengaluru, Karnataka 560025',
      'letter.opening':
        'Open with why you are writing, in one or two sentences. A reader who stops after the first paragraph should still know what the letter is for and what, if anything, is being asked of them.',
      'letter.body':
        'Use the second paragraph for the detail — dates, amounts, references, anything the reader will need to act. Keep one idea to a paragraph, and put the request before the justification rather than after it.',
      'letter.enclosure_one': 'List anything sent with the letter here.',
      'letter.enclosure_two': 'Delete this section if nothing is enclosed.',
      'letter.closing':
        'Close by saying what happens next and by when. Give a name and a way to reach it.',
      'signatory.name': 'Devika Menon',
      'signatory.title': 'Chief Operating Officer, Northwind Traders Pvt Ltd',
    },
  },

  // ── Legal ──────────────────────────────────────────────────────────────────
  //
  // These are document LAYOUTS with sample wording, not legal advice, and the
  // marketing prose says so. The sample clauses exist to show where text goes
  // and roughly how long it runs — the header on each makes clear the wording
  // is to be replaced.

  {
    slug: 'free-rent-agreement-template',
    category: 'Legal',
    name: 'Rent Agreement',
    build: () =>
      longFormDoc({
        title: 'Rent Agreement',
        subtitle: 'A residential leave and licence agreement between a landlord and a tenant.',
        accent: ACCENT.Legal,
        meta: [
          ['Agreement no.', '{{agreement.number}}'],
          ['Date of agreement', '{{agreement.date}}'],
          ['Term', '{{agreement.term}}'],
          ['Commencing', '{{agreement.start_date}}'],
        ],
        parties: [
          {
            heading: 'Landlord',
            lines: ['{{party_one.name}}', '{{party_one.address}}', '{{party_one.registration}}'],
          },
          {
            heading: 'Tenant',
            lines: ['{{party_two.name}}', '{{party_two.address}}', '{{party_two.registration}}'],
          },
        ],
        intro:
          'The landlord lets and the tenant takes on leave and licence the premises at {{property.address}}, comprising {{property.description}}.',
        sections: [
          {
            heading: '1. Rent and deposit',
            items: [
              'Monthly rent: {{terms.rent}}, payable in advance by the {{terms.rent_due_day}} of each month.',
              'Security deposit: {{terms.deposit}}, refundable within {{terms.deposit_refund}} of vacating, less lawful deductions.',
              'Rent escalation: {{terms.escalation}}.',
            ],
          },
          {
            heading: '2. Use of the premises',
            body: 'The premises shall be used for {{terms.permitted_use}} only. The tenant shall not sublet or assign without written consent, nor make structural alterations.',
            height: 46,
          },
          {
            heading: '3. Maintenance and outgoings',
            items: [
              'Society maintenance: {{terms.maintenance_by}}.',
              'Electricity and water on actuals: {{terms.utilities_by}}.',
              'Municipal taxes: {{terms.taxes_by}}. Minor repairs to {{terms.minor_repairs}}: the tenant.',
            ],
          },
          {
            heading: '4. Termination',
            body: 'Either party may terminate on {{terms.notice}} written notice. The landlord may terminate on non-payment of rent for {{terms.default_period}}.',
            height: 30,
          },
        ],
        footer: 'Sample wording for layout purposes. Replace the clauses with terms drafted for your situation.',
      }),
    values: {
      'agreement.number': 'RA-2026-0117',
      'agreement.date': '17 August 2026',
      'agreement.term': '11 months',
      'agreement.start_date': '01 September 2026',
      'property.address': 'Flat 402, Brigade Gardens, Koramangala, Bengaluru 560034',
      'property.description': 'two bedrooms, one hall, kitchen and two bathrooms, semi-furnished',
      'terms.rent': '₹42,000 per month',
      'terms.rent_due_day': '5th',
      'terms.deposit': '₹2,52,000 (six months’ rent)',
      'terms.deposit_refund': '30 days',
      'terms.escalation': '5% on renewal after 11 months',
      'terms.payment_method': 'Bank transfer to the landlord’s account on or before the due date',
      'terms.permitted_use': 'residential purposes by the tenant and immediate family',
      'terms.maintenance_by': 'Payable by the landlord',
      'terms.utilities_by': 'Payable by the tenant',
      'terms.taxes_by': 'Payable by the landlord',
      'terms.minor_repairs': '₹2,000',
      'terms.notice': 'two months’',
      'terms.default_period': 'two consecutive months',
      'party_one.name': 'Mr Suresh Prabhu',
      'party_one.address': '9 Palm Grove, Whitefield, Bengaluru 560066',
      'party_one.registration': 'PAN ABCPP1234K',
      'party_one.signatory': 'Suresh Prabhu, Landlord',
      'party_two.name': 'Ms Priya Nair',
      'party_two.address': '18 Lakeview Apartments, Indiranagar, Bengaluru 560038',
      'party_two.registration': 'PAN DEFPN5678L',
      'party_two.signatory': 'Priya Nair, Tenant',
    },
  },

  {
    slug: 'free-affidavit-template',
    category: 'Legal',
    name: 'Affidavit',
    build: () =>
      longFormDoc({
        title: 'Affidavit',
        subtitle: 'A sworn written statement of facts, made on oath before an authorised officer.',
        accent: ACCENT.Legal,
        meta: [
          ['Affidavit no.', '{{affidavit.number}}'],
          ['Date', '{{affidavit.date}}'],
          ['Place', '{{affidavit.place}}'],
          ['Purpose', '{{affidavit.purpose}}'],
        ],
        parties: [
          {
            heading: 'Deponent',
            lines: ['{{party_one.name}}', '{{party_one.address}}', '{{party_one.registration}}'],
          },
          {
            heading: 'Sworn before',
            lines: ['{{party_two.name}}', '{{party_two.address}}', '{{party_two.registration}}'],
          },
        ],
        intro:
          'I, {{party_one.name}}, {{deponent.relation}} {{deponent.parent}}, aged {{deponent.age}} years, residing at {{party_one.address}}, do hereby solemnly affirm and declare as follows:',
        sections: [
          {
            heading: '1. Statements of fact',
            items: [
              '{{affidavit.statement_one}}',
              '{{affidavit.statement_two}}',
              '{{affidavit.statement_three}}',
            ],
          },
          {
            heading: '2. Verification',
            body: 'I state that the contents of paragraph 1 above are true to the best of my knowledge and belief, that nothing material has been concealed, and that no part of this affidavit is false.',
            height: 46,
          },
          {
            heading: '3. Declaration',
            body: 'Solemnly affirmed at {{affidavit.place}} on {{affidavit.date}}. I make this affidavit for the purpose of {{affidavit.purpose}} and for no other purpose.',
            height: 40,
          },
        ],
        footer: 'Sample wording for layout purposes. Affidavits have formal requirements that vary by state and by purpose.',
      }),
    values: {
      'affidavit.number': 'AFF-2026-0233',
      'affidavit.date': '17 August 2026',
      'affidavit.place': 'Bengaluru, Karnataka',
      'affidavit.purpose': 'a change of name record',
      'deponent.relation': 'daughter of',
      'deponent.parent': 'Mr R. Ramesh',
      'deponent.age': '34',
      'affidavit.statement_one':
        'That my name was recorded as Kavya R. in my school records and as Kavya Ramesh in my other identity documents.',
      'affidavit.statement_two':
        'That both names refer to one and the same person, namely myself, and no other person is referred to by either.',
      'affidavit.statement_three':
        'That I wish my name to be recorded uniformly as Kavya Ramesh in all official records hereafter.',
      'party_one.name': 'Ms Kavya Ramesh',
      'party_one.address': '12 Sunrise Colony, Aundh, Pune 411007',
      'party_one.registration': 'Aadhaar ending 4417 · PAN GHIPK9012M',
      'party_one.signatory': 'Kavya Ramesh, Deponent',
      'party_two.name': 'Notary Public',
      'party_two.address': 'City Civil Court complex, Bengaluru 560009',
      'party_two.registration': 'Notary registration KA/NOT/2019/0447',
      'party_two.signatory': 'Notary Public, seal and signature',
    },
  },

  {
    slug: 'free-power-of-attorney-template',
    category: 'Legal',
    name: 'Power of Attorney',
    build: () =>
      longFormDoc({
        title: 'Power of Attorney',
        subtitle: 'An authority given by one person to another to act on their behalf in defined matters.',
        accent: ACCENT.Legal,
        meta: [
          ['Instrument no.', '{{poa.number}}'],
          ['Date', '{{poa.date}}'],
          ['Type', '{{poa.type}}'],
          ['Valid until', '{{poa.valid_until}}'],
        ],
        parties: [
          {
            heading: 'Principal (grantor)',
            lines: ['{{party_one.name}}', '{{party_one.address}}', '{{party_one.registration}}'],
          },
          {
            heading: 'Attorney (grantee)',
            lines: ['{{party_two.name}}', '{{party_two.address}}', '{{party_two.registration}}'],
          },
        ],
        intro:
          'I, {{party_one.name}}, appoint {{party_two.name}} as my lawful attorney to act on my behalf in the matters set out below, and to do all things reasonably necessary to give effect to that authority.',
        sections: [
          {
            heading: '1. Powers granted',
            items: [
              '{{poa.power_one}}',
              '{{poa.power_two}}',
              '{{poa.power_three}}',
            ],
          },
          {
            heading: '2. Limits on the authority',
            body: '{{poa.limits}}',
            height: 46,
          },
          {
            heading: '3. Duration and revocation',
            body: 'This power takes effect on {{poa.effective_date}} and remains in force until {{poa.valid_until}} unless revoked earlier in writing. Revocation takes effect when written notice reaches the attorney and any party relying on this instrument.',
            height: 46,
          },
          {
            heading: '4. Ratification',
            body: 'I ratify all lawful acts done by the attorney within the authority granted above, and undertake to be bound by them as if done by me personally.',
            height: 40,
          },
        ],
        footer: 'Sample wording for layout purposes. A power of attorney may need to be stamped, notarised or registered.',
      }),
    values: {
      'poa.number': 'POA-2026-0058',
      'poa.date': '17 August 2026',
      'poa.type': 'Special (limited to the matters listed)',
      'poa.valid_until': '31 August 2027',
      'poa.effective_date': '01 September 2026',
      'poa.power_one':
        'To manage and let the property at Flat 402, Brigade Gardens, Koramangala, Bengaluru 560034, and to sign leave and licence agreements for terms not exceeding eleven months.',
      'poa.power_two':
        'To collect rent and deposits, issue receipts, and operate the designated rent account for that property.',
      'poa.power_three':
        'To represent me before the housing society, utility providers and municipal authorities in respect of that property.',
      'poa.limits':
        'This authority does not extend to selling, mortgaging, gifting or otherwise disposing of the property, nor to borrowing against it, nor to any property other than the one named above.',
      'party_one.name': 'Mr Suresh Prabhu',
      'party_one.address': '9 Palm Grove, Whitefield, Bengaluru 560066',
      'party_one.registration': 'PAN ABCPP1234K',
      'party_one.signatory': 'Suresh Prabhu, Principal',
      'party_two.name': 'Ms Meena Iyer',
      'party_two.address': '44 Jubilee Residency, HSR Layout, Bengaluru 560102',
      'party_two.registration': 'PAN JKLPI3456N',
      'party_two.signatory': 'Meena Iyer, Attorney',
    },
  },

  {
    slug: 'free-mou-template',
    category: 'Legal',
    name: 'MoU',
    build: () =>
      longFormDoc({
        title: 'Memorandum of Understanding',
        subtitle: 'A record of what two parties have agreed in principle, ahead of a binding contract.',
        accent: ACCENT.Legal,
        meta: [
          ['MoU no.', '{{mou.number}}'],
          ['Effective date', '{{mou.effective_date}}'],
          ['Review date', '{{mou.review_date}}'],
          ['Status', '{{mou.status}}'],
        ],
        parties: [
          {
            heading: 'First party',
            lines: ['{{party_one.name}}', '{{party_one.address}}', '{{party_one.registration}}'],
          },
          {
            heading: 'Second party',
            lines: ['{{party_two.name}}', '{{party_two.address}}', '{{party_two.registration}}'],
          },
        ],
        intro:
          'The parties wish to record their shared understanding regarding {{mou.purpose}}. This memorandum sets out what each intends to contribute and how they will work together while a definitive agreement is negotiated.',
        sections: [
          {
            heading: '1. Shared objectives',
            body: '{{mou.objectives}}',
            height: 46,
          },
          {
            heading: '2. What each party will contribute',
            items: [
              'First party: {{mou.contribution_one}}',
              'Second party: {{mou.contribution_two}}',
              'Both parties: {{mou.contribution_shared}}',
            ],
          },
          {
            heading: '3. Status of this memorandum',
            body: '{{mou.binding_status}}',
            height: 46,
          },
          {
            heading: '4. Confidentiality and term',
            body: 'Each party will keep the other’s non-public information confidential. This memorandum runs until {{mou.review_date}} and may be extended or replaced by a definitive agreement in writing.',
            height: 46,
          },
        ],
        footer: 'Sample wording for layout purposes. Whether an MoU binds depends on what it says and how the parties act.',
      }),
    values: {
      'mou.number': 'MOU-2026-0009',
      'mou.effective_date': '01 September 2026',
      'mou.review_date': '28 February 2027',
      'mou.status': 'Non-binding except where stated',
      'mou.purpose': 'a joint distribution arrangement across south India',
      'mou.objectives':
        'To test whether combining Northwind’s storage products with Halcyon’s design and fit-out practice produces a proposition both can sell, across three pilot cities, before committing to a formal joint venture.',
      'mou.contribution_one':
        'product supply at agreed transfer prices, technical training and installation support.',
      'mou.contribution_two':
        'client relationships, design services and project management on pilot engagements.',
      'mou.contribution_shared':
        'joint marketing at two trade events, and a shared pipeline review each month.',
      'mou.binding_status':
        'Clauses 3 and 4 are intended to be legally binding. The remainder records intent only and creates no obligation to enter a definitive agreement, no exclusivity, and no liability for withdrawal.',
      'party_one.name': 'Northwind Traders Pvt Ltd',
      'party_one.address': '4th Floor, Prestige Corner, MG Road, Bengaluru 560001',
      'party_one.registration': 'CIN U51909KA2015PTC081234',
      'party_one.signatory': 'Devika Menon, Chief Operating Officer',
      'party_two.name': 'Halcyon Design Studio LLP',
      'party_two.address': '22 Residency Road, Bengaluru 560025',
      'party_two.registration': 'LLPIN AAC-8812',
      'party_two.signatory': 'Nikhil Menon, Designated Partner',
    },
  },

  {
    slug: 'free-partnership-deed-template',
    category: 'Legal',
    name: 'Partnership Deed',
    build: () =>
      longFormDoc({
        title: 'Partnership Deed',
        subtitle: 'The constitution of a partnership firm — capital, shares, roles and dissolution.',
        accent: ACCENT.Legal,
        meta: [
          ['Deed no.', '{{deed.number}}'],
          ['Date of deed', '{{deed.date}}'],
          ['Firm name', '{{deed.firm_name}}'],
          ['Commencement', '{{deed.commencement}}'],
        ],
        parties: [
          {
            heading: 'First partner',
            lines: ['{{party_one.name}}', '{{party_one.address}}', '{{party_one.registration}}'],
          },
          {
            heading: 'Second partner',
            lines: ['{{party_two.name}}', '{{party_two.address}}', '{{party_two.registration}}'],
          },
        ],
        intro:
          'The partners will carry on the business of {{deed.business}} under the name {{deed.firm_name}}, at {{deed.place}}.',
        sections: [
          {
            heading: '1. Capital and profit sharing',
            items: [
              'Capital contributed — first partner: {{deed.capital_one}}.',
              'Capital contributed — second partner: {{deed.capital_two}}.',
              'Profits and losses shared: {{deed.profit_share}}. Interest on capital: {{deed.interest_on_capital}}.',
            ],
          },
          {
            heading: '2. Management and duties',
            body: '{{deed.management}}',
            height: 46,
          },
          {
            heading: '3. Banking and accounts',
            items: [
              'Bank operations: {{deed.banking}}.',
              'Books of account kept at the principal place of business, open to both partners.',
              'Accounts closed on {{deed.year_end}} each year. Drawings limited to {{deed.drawings}} per partner per month.',
            ],
          },
          {
            heading: '4. Retirement and dissolution',
            body: 'A partner may retire on {{deed.retirement_notice}} written notice. Accounts are settled after liabilities, goodwill valued at {{deed.goodwill}}.',
            height: 30,
          },
        ],
        footer: 'Sample wording for layout purposes. Partnership deeds are usually stamped and may be registered.',
      }),
    values: {
      'deed.number': 'PD-2026-0021',
      'deed.date': '17 August 2026',
      'deed.firm_name': 'Prabhu & Iyer Associates',
      'deed.commencement': '01 September 2026',
      'deed.business': 'industrial fit-out consultancy and project management',
      'deed.place': '9 Palm Grove, Whitefield, Bengaluru 560066',
      'deed.capital_one': '₹15,00,000',
      'deed.capital_two': '₹10,00,000',
      'deed.profit_share': '60% to the first partner and 40% to the second',
      'deed.interest_on_capital': '6% per annum on the opening balance',
      'deed.management':
        'The first partner is responsible for operations and delivery, the second for finance and client relationships. Expenditure above ₹2,00,000 needs both partners’ written consent.',
      'deed.banking': 'Accounts operated jointly; cheques above ₹1,00,000 signed by both partners',
      'deed.year_end': '31 March',
      'deed.drawings': '₹1,00,000',
      'deed.retirement_notice': 'three months’',
      'deed.goodwill': 'two years’ purchase of average net profit',
      'party_one.name': 'Mr Suresh Prabhu',
      'party_one.address': '9 Palm Grove, Whitefield, Bengaluru 560066',
      'party_one.registration': 'PAN ABCPP1234K',
      'party_one.signatory': 'Suresh Prabhu, Partner',
      'party_two.name': 'Ms Meena Iyer',
      'party_two.address': '44 Jubilee Residency, HSR Layout, Bengaluru 560102',
      'party_two.registration': 'PAN JKLPI3456N',
      'party_two.signatory': 'Meena Iyer, Partner',
    },
  },

  {
    slug: 'free-consultancy-agreement-template',
    category: 'Legal',
    name: 'Consultancy Agreement',
    build: () =>
      longFormDoc({
        title: 'Consultancy Agreement',
        subtitle: 'An engagement of an independent consultant — scope, fees, IP and termination.',
        accent: ACCENT.Legal,
        meta: [
          ['Agreement no.', '{{agreement.number}}'],
          ['Effective date', '{{agreement.effective_date}}'],
          ['Initial term', '{{agreement.term}}'],
          ['Governing law', '{{agreement.governing_law}}'],
        ],
        parties: [
          {
            heading: 'Client',
            lines: ['{{party_one.name}}', '{{party_one.address}}', '{{party_one.registration}}'],
          },
          {
            heading: 'Consultant',
            lines: ['{{party_two.name}}', '{{party_two.address}}', '{{party_two.registration}}'],
          },
        ],
        intro:
          'The client engages the consultant to provide {{agreement.services}}, to be performed with reasonable skill and care.',
        sections: [
          {
            heading: '1. Services and time commitment',
            body: '{{agreement.scope}}',
            height: 46,
          },
          {
            heading: '2. Fees and expenses',
            items: [
              'Fees: {{agreement.fees}}.',
              'Invoicing: {{agreement.invoicing}}, payable {{agreement.payment_terms}}.',
              'Expenses: pre-approved and reimbursed at cost against receipts.',
              'Taxes: the consultant is responsible for their own tax and statutory obligations.',
            ],
          },
          {
            heading: '3. Status, IP and confidentiality',
            items: [
              'The consultant is an independent contractor and not an employee, agent or partner of the client.',
              'Intellectual property created in performing the services: {{agreement.ip}}.',
              'Each party keeps the other’s confidential information confidential during and after the term.',
              'The consultant may work for others provided there is no conflict with this engagement.',
            ],
          },
          {
            heading: '4. Termination',
            body: 'Either party may terminate on {{agreement.notice}} written notice, or for material breach not remedied within {{agreement.cure_period}}.',
            height: 46,
          },
        ],
        footer: 'Sample wording for layout purposes. Contractor status is judged on the working reality, not the label.',
      }),
    values: {
      'agreement.number': 'CA-2026-0064',
      'agreement.effective_date': '01 September 2026',
      'agreement.term': '12 months',
      'agreement.governing_law': 'India, courts at Bengaluru',
      'agreement.services': 'supply-chain advisory and process design services',
      'agreement.scope':
        'The consultant will review warehouse and distribution processes across two sites and support implementation. Expected commitment is eight days a month, two of them on site.',
      'agreement.fees': '₹1,80,000 per month, exclusive of applicable taxes',
      'agreement.invoicing': 'monthly in arrears',
      'agreement.payment_terms': 'within 30 days of a valid invoice',
      'agreement.ip':
        'vests in the client on payment; the consultant keeps pre-existing materials',
      'agreement.notice': 'one month’s',
      'agreement.cure_period': '15 days',
      'party_one.name': 'Northwind Traders Pvt Ltd',
      'party_one.address': '4th Floor, Prestige Corner, MG Road, Bengaluru 560001',
      'party_one.registration': 'CIN U51909KA2015PTC081234',
      'party_one.signatory': 'Devika Menon, Chief Operating Officer',
      'party_two.name': 'Mr K. Subramanian',
      'party_two.address': 'Level 6, Cyber Towers, Hitec City, Hyderabad 500081',
      'party_two.registration': 'PAN MNOPS7890Q · GSTIN 36MNOPS7890Q1ZR',
      'party_two.signatory': 'K. Subramanian, Consultant',
    },
  },

  {
    slug: 'free-loan-agreement-template',
    category: 'Legal',
    name: 'Loan Agreement',
    build: () =>
      longFormDoc({
        title: 'Loan Agreement',
        subtitle: 'A private loan between two parties — amount, interest, repayment and default.',
        accent: ACCENT.Legal,
        meta: [
          ['Agreement no.', '{{loan.number}}'],
          ['Date', '{{loan.date}}'],
          ['Principal', '{{loan.principal}}'],
          ['Term', '{{loan.term}}'],
        ],
        parties: [
          {
            heading: 'Lender',
            lines: ['{{party_one.name}}', '{{party_one.address}}', '{{party_one.registration}}'],
          },
          {
            heading: 'Borrower',
            lines: ['{{party_two.name}}', '{{party_two.address}}', '{{party_two.registration}}'],
          },
        ],
        intro:
          'The lender lends and the borrower borrows {{loan.principal}} for {{loan.purpose}}, on the terms below.',
        sections: [
          {
            heading: '1. Interest and repayment',
            items: [
              'Interest: {{loan.interest}}, calculated on the reducing balance.',
              'Repayment: {{loan.repayment}}.',
              'First instalment due: {{loan.first_due}}. Prepayment permitted without penalty.',
            ],
          },
          {
            heading: '2. Security',
            body: '{{loan.security}}',
            height: 46,
          },
          {
            heading: '3. Events of default',
            items: [
              'Failure to pay any instalment within {{loan.grace_period}} of its due date.',
              'Any material misstatement made by the borrower in connection with this loan.',
              'Insolvency of the borrower. On default the balance falls due, with interest at {{loan.default_interest}}.',
            ],
          },
          {
            heading: '4. General',
            body: 'Governed by {{loan.governing_law}}. Variations must be in writing and signed by both parties.',
            height: 30,
          },
        ],
        footer: 'Sample wording for layout purposes. Interest rates and enforcement are subject to law.',
      }),
    values: {
      'loan.number': 'LA-2026-0031',
      'loan.date': '17 August 2026',
      'loan.principal': '₹12,00,000',
      'loan.term': '36 months',
      'loan.purpose': 'working capital for the borrower’s design practice',
      'loan.interest': '11% per annum',
      'loan.repayment': '36 equal monthly instalments of ₹39,290',
      'loan.first_due': '05 October 2026',
      'loan.security':
        'The loan is unsecured. The borrower will not charge its receivables ahead of this loan while any amount is outstanding.',
      'loan.grace_period': '15 days',
      'loan.default_interest': '15% per annum from the date of default',
      'loan.governing_law': 'the laws of India, with courts at Bengaluru having jurisdiction',
      'party_one.name': 'Mr Suresh Prabhu',
      'party_one.address': '9 Palm Grove, Whitefield, Bengaluru 560066',
      'party_one.registration': 'PAN ABCPP1234K',
      'party_one.signatory': 'Suresh Prabhu, Lender',
      'party_two.name': 'Halcyon Design Studio LLP',
      'party_two.address': '22 Residency Road, Bengaluru 560025',
      'party_two.registration': 'LLPIN AAC-8812',
      'party_two.signatory': 'Nikhil Menon, Designated Partner',
    },
  },
]

// ── Emit ─────────────────────────────────────────────────────────────────────

/**
 * Every `{{name}}` the layout references, plus each table's `dataKey`.
 *
 * <p>The placeholders stay in the content. An earlier version flattened them to
 * literal text, because the editor canvas used to render a merge field as its
 * field-name chip and a page full of `Global.Company Name` reads as a wireframe
 * rather than a certificate — which is fatal on a public landing page.
 *
 * <p>That is now fixed at the source: the canvas has a Values toggle, on by
 * default, which renders the preview value instead. So these can be real
 * templates — a forked invoice has `{{customer.name}}` wired to a field you can
 * change once — while still looking like finished documents everywhere they are
 * shown. Flattening them was solving the symptom.
 */
function collectVariables(elements) {
  const found = new Set()
  const scan = (value) => {
    if (typeof value === 'string') {
      for (const m of value.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*}}/g)) found.add(m[1])
    } else if (Array.isArray(value)) {
      value.forEach(scan)
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(scan)
    }
  }
  scan(elements)
  for (const el of elements) {
    if (el.type === 'TABLE' && el.dataKey) found.add(el.dataKey)
  }
  return [...found].sort()
}


// Nothing is written until every template validates. The directory used to be
// emptied here, before the loop, so a run that failed validation still replaced
// the working bundles with the broken ones it had already written — the worst
// of both outcomes. Build in memory, then commit or leave the last good set
// untouched.
let failed = false
const outputs = []

for (const tpl of TEMPLATES) {
  seq = 0
  activeValues = tpl.values
  const elements = tpl.build()

  const referenced = collectVariables(elements)

  // Every referenced field must have a preview value. Without one the canvas
  // falls back to the field-name chip, and the landing page is a wireframe
  // again — so this is the check that keeps the templates presentable.
  // A typo'd category would reach the bundle, the seeder and the marketing hub
  // before anyone noticed, so it fails generation here instead.
  if (!CATEGORIES.includes(tpl.category)) {
    console.error(`  ✗ ${tpl.slug}: unknown category ${JSON.stringify(tpl.category)}`
      + ` — expected one of ${CATEGORIES.join(', ')}`)
    failed = true
  }

  const missing = referenced.filter((key) => tpl.values[key] === undefined)
  if (missing.length > 0) {
    console.error(`  ✗ ${tpl.slug}: no preview value for ${missing.join(', ')}`)
    failed = true
  }

  const globalVariables = referenced.map((key) => ({ key }))
  const variableValues = Object.fromEntries(
    referenced.filter((key) => tpl.values[key] !== undefined).map((key) => [key, tpl.values[key]]))

  // Boxes are sized to hold their own text, but a box that grew can still land
  // on its neighbour — that is exactly how the marksheet shipped with
  // "Technology" printed across its own address line. Nothing overflowed, so
  // the overflow check was silent; the two boxes' contents simply occupied the
  // same space. Checked here, against the resolved values, so a bad layout
  // fails generation instead of reaching a landing page.
  // `contentHeight` is scratch for the layout math above — strip it before it
  // reaches the bundle, where it would be an unrecognised element property.
  for (const el of elements) delete el.contentHeight

  const collisions = findCollisions(elements, variableValues)
  if (collisions.length > 0) {
    console.error(`  ✗ ${tpl.slug}: text collides —`)
    for (const c of collisions.slice(0, 8)) console.error(`      ${c}`)
    if (collisions.length > 8) console.error(`      … ${collisions.length - 8} more`)
    failed = true
  }

  const layout = {
    page: {
      size: 'A4',
      margin: M,
      margins: { top: M, right: M, bottom: M, left: M },
      orientation: 'portrait',
    },
    layoutSchemaVersion: 2,
    globalVariables,
    elements,
    pages: [{ id: 'page_1', name: 'Page 1', elements }],
  }

  const payload = {
    __agreemint_template__: true,
    version: 2,
    // Carried in the bundle so every consumer reads the same answer. The
    // backend seeder prefers this over its slug-keyword fallback, and the
    // console's catalogue test asserts TRY_TEMPLATES agrees with it.
    category: tpl.category,
    layout,
    variableValues,
    exportedAt: EXPORTED_AT,
  }

  outputs.push({ slug: tpl.slug, payload })
  console.log(`  ${tpl.slug}  ${elements.length} elements, ${globalVariables.length} variables`)
}

if (failed) {
  console.error('\nGeneration failed — nothing written, existing bundles left as they were.')
  process.exit(1)
}

function commit(dir) {
  mkdirSync(dir, { recursive: true })
  for (const stale of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    unlinkSync(join(dir, stale))
  }
  for (const { slug, payload } of outputs) {
    writeFileSync(join(dir, `${slug}.json`), `${JSON.stringify(payload, null, 2)}\n`)
  }
}

commit(OUT_DIR)
console.log(`\n${outputs.length} templates written to src/try-templates/`)

// The backend copy is best-effort: its absence means someone is building the
// console alone, which is legitimate. A write that FAILS, though, is not — that
// would leave the marketplace seeded from a stale catalogue.
if (existsSync(dirname(SEED_OUT_DIR))) {
  commit(SEED_OUT_DIR)
  console.log(`${outputs.length} templates written to the backend seed resources`)
} else {
  console.log('backend repo not found alongside — skipped the marketplace seed copy')
}
