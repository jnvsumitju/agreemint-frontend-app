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

import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'try-templates')

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
}

const SANS = 'Inter'
const SERIF = 'Source Serif 4'
const MONO = 'JetBrains Mono'

// ── Element factories ────────────────────────────────────────────────────────

let seq = 0
const id = (p) => `${p}${String(++seq).padStart(3, '0')}`

function text(x, y, width, height, content, style = {}) {
  return {
    id: id('t'),
    type: 'TEXT',
    x,
    y,
    width,
    height,
    content,
    style: { fontSize: 10, fontFamily: SANS, color: BODY, lineHeight: 1.45, ...style },
  }
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
  els.push(
    text(M + 12, M, 250, 20, `{{${prefix}.name}}`, {
      fontSize: 16,
      bold: true,
      color: INK,
    })
  )
  // 46pt, not 30: this block is three lines (two of address, one of contact) at
  // 8.5pt on a 1.4 line-height, so it needs ~36pt — and the address is the
  // field a user is most likely to make longer, not shorter. A box sized to the
  // sample data clips the moment anyone edits it, silently, with no warning on
  // the canvas.
  els.push(
    text(M + 12, M + 20, 270, 46, `{{${prefix}.address}}\n{{${prefix}.contact}}`, {
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
    els.push(text(RIGHT - 230, y, 110, 12, k, { fontSize: 8.5, color: MUTED, align: 'right' }))
    els.push(
      text(RIGHT - 116, y, 116, 12, v, {
        fontSize: 8.5,
        color: INK,
        align: 'right',
        fontFamily: MONO,
      })
    )
    y += 13
  }

  const bottom = Math.max(y, M + 62) + 10
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
    if (strong) {
      els.push(rect(x, cy - 4, width, 22, { backgroundColor: SOFT, borderRadius: 3 }))
    }
    els.push(
      text(x + 8, cy, labelW, 14, row.label, {
        fontSize: strong ? 10 : 9,
        bold: strong,
        color: strong ? INK : MUTED,
        align: 'right',
      })
    )
    els.push(
      text(x + labelW, cy, valueW - 8, 14, row.value, {
        fontSize: strong ? 11 : 9.5,
        bold: strong,
        color: strong ? accent : INK,
        align: 'right',
        fontFamily: MONO,
      })
    )
    cy += strong ? 26 : 16
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

  els.push(
    text(M, y, CW, 16, cfg.closing ?? 'Yours sincerely,', { fontSize: 10, color: BODY })
  )
  signature(els, M, y + 46, 200, '{{signatory.name}}', '{{signatory.title}}')

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

// ── The twenty templates ─────────────────────────────────────────────────────

const TEMPLATES = [
  // ── Finance ────────────────────────────────────────────────────────────────
  {
    slug: 'free-invoice-template',
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
            body: 'During {{recipient.pronoun_possessive}} tenure, {{recipient.pronoun_subject}} was responsible for {{employment.responsibilities}}. We found {{recipient.pronoun_object}} to be {{employment.conduct}}, and {{recipient.pronoun_possessive}} contribution to the team was valued.',
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
      'balances.payments': '₹1,41,600.00',
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


mkdirSync(OUT_DIR, { recursive: true })
for (const stale of readdirSync(OUT_DIR).filter((f) => f.endsWith('.json'))) {
  unlinkSync(join(OUT_DIR, stale))
}

let failed = false

for (const tpl of TEMPLATES) {
  seq = 0
  const elements = tpl.build()

  const referenced = collectVariables(elements)

  // Every referenced field must have a preview value. Without one the canvas
  // falls back to the field-name chip, and the landing page is a wireframe
  // again — so this is the check that keeps the templates presentable.
  const missing = referenced.filter((key) => tpl.values[key] === undefined)
  if (missing.length > 0) {
    console.error(`  ✗ ${tpl.slug}: no preview value for ${missing.join(', ')}`)
    failed = true
  }

  const globalVariables = referenced.map((key) => ({ key }))
  const variableValues = Object.fromEntries(
    referenced.filter((key) => tpl.values[key] !== undefined).map((key) => [key, tpl.values[key]]))

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
    layout,
    variableValues,
    exportedAt: EXPORTED_AT,
  }

  writeFileSync(join(OUT_DIR, `${tpl.slug}.json`), `${JSON.stringify(payload, null, 2)}\n`)
  console.log(`  ${tpl.slug}  ${elements.length} elements, ${globalVariables.length} variables`)
}

if (failed) {
  console.error('\nGeneration failed — see the errors above.')
  process.exit(1)
}

console.log(`\n${TEMPLATES.length} templates written to src/try-templates/`)
