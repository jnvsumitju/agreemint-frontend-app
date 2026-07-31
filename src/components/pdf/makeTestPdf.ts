/**
 * A minimal, valid multi-page PDF, built in the browser.
 *
 * <p>Exists so the viewer can be driven — by hand in dev, and by the Playwright
 * suite — without a backend, a login, or a binary fixture checked into the repo.
 * The pixel-parity suite needs a real generated document; this one only needs to
 * be *a* PDF with a known number of pages at a known size, which is exactly what
 * the viewer's geometry and virtualization are asserted against.
 *
 * <p>Hand-assembled rather than pulled from a library: the viewer already ships
 * pdf.js for reading, and adding a PDF *writer* to the bundle to produce a
 * three-object test file would be a poor trade. Everything here is the PDF 1.4
 * structure from ISO 32000-1 §7.5 — a catalog, a page tree, one content stream
 * per page, and a cross-reference table of byte offsets.
 */

export interface TestPdfOptions {
  pages?: number
  /** Page size in PDF points. Defaults to US Letter. */
  width?: number
  height?: number
  /** Extra text lines per page, to give the rasteriser something to draw. */
  lines?: number
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

export function makeTestPdf({
  pages = 3,
  width = 612,
  height = 792,
  lines = 18,
}: TestPdfOptions = {}): Blob {
  const objects: string[] = []
  /** 1-based object numbers, so index 0 is the free entry. */
  const add = (body: string): number => {
    objects.push(body)
    return objects.length
  }

  // Reserve 1 (catalog) and 2 (page tree) so the kids array can name page
  // objects that do not exist yet.
  objects.push('', '')
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

  const pageIds: number[] = []
  for (let p = 0; p < pages; p++) {
    const parts: string[] = []
    parts.push('BT /F1 28 Tf 1 0 0 1 60 ' + (height - 90) + ' Tm')
    parts.push(`(${escapeText(`Crixaa test document - page ${p + 1} of ${pages}`)}) Tj ET`)

    // A solid dark band under the title. Text alone covers only ~2% of a page,
    // which is too close to zero to distinguish a rendered page from a blank one
    // when a test measures a zoomed-in crop. This gives every region near the
    // top of the page an unmistakable amount of ink at any zoom level.
    parts.push(`0.16 0.16 0.19 rg ${60} ${height - 132} ${width - 120} 28 re f`)
    for (let l = 0; l < lines; l++) {
      const y = height - 160 - l * 26
      if (y < 60) break
      parts.push(`BT /F1 13 Tf 1 0 0 1 60 ${y} Tm`)
      parts.push(
        `(${escapeText(
          `Line ${String(l + 1).padStart(2, '0')} - the quick brown fox jumps over the lazy dog 0123456789`,
        )}) Tj ET`,
      )
    }
    // A rule down the page, so a blank render is unmistakable even without text.
    parts.push(`0.6 w 60 60 m ${width - 60} 60 l S`)

    const stream = parts.join('\n')
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    pageIds.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
          `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    )
  }

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`

  // Serialise, recording each object's byte offset for the xref table.
  const header = '%PDF-1.4\n'
  let body = ''
  const offsets: number[] = []
  for (let i = 0; i < objects.length; i++) {
    offsets.push(header.length + body.length)
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }

  const xrefOffset = header.length + body.length
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`

  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`

  // One byte per character, deliberately not TextEncoder. Every character
  // written above is ASCII, so this is lossless — and it keeps the recorded
  // offsets byte-accurate, whereas UTF-8 would silently widen any non-ASCII
  // character and invalidate the whole xref table. Keep the content ASCII.
  const text = header + body + xref + trailer
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff
  return new Blob([bytes], { type: 'application/pdf' })
}
