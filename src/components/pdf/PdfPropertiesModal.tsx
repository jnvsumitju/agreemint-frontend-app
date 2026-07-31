import { PDFDateString } from 'pdfjs-dist'
import { Modal } from '../ui/Modal'
import type { PdfDocumentInfo } from './usePdfDocument'
import type { PageSize } from './pageLayout'

/**
 * Named paper sizes, in PDF points, with the tolerance a generator's rounding
 * needs. Showing "612 × 792 pt" is accurate and useless; "8.5 × 11 in (Letter)"
 * is what someone checking a document actually wants to know.
 */
const PAPER: Array<{ name: string; w: number; h: number }> = [
  { name: 'Letter', w: 612, h: 792 },
  { name: 'Legal', w: 612, h: 1008 },
  { name: 'Tabloid', w: 792, h: 1224 },
  { name: 'A3', w: 842, h: 1191 },
  { name: 'A4', w: 595, h: 842 },
  { name: 'A5', w: 420, h: 595 },
]

function describePageSize(size: PageSize | undefined): string | null {
  if (!size) return null
  const { width, height } = size
  const match = PAPER.find(
    (p) =>
      (Math.abs(p.w - width) <= 3 && Math.abs(p.h - height) <= 3) ||
      (Math.abs(p.h - width) <= 3 && Math.abs(p.w - height) <= 3),
  )
  const inches = `${(width / 72).toFixed(2).replace(/\.?0+$/, '')} × ${(height / 72)
    .toFixed(2)
    .replace(/\.?0+$/, '')} in`
  const orientation = width > height ? ' landscape' : ''
  return match ? `${inches} (${match.name}${orientation})` : inches
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  // pdf.js parses the "D:20250731120000+05'30'" form and applies the offset,
  // returning an absolute instant — so format it explicitly rather than
  // assuming the wall-clock fields survived.
  const date = PDFDateString.toDateObject(raw)
  if (!date) return null
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function asText(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return null
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6 border-b border-zinc-100 py-1.5 last:border-b-0 dark:border-zinc-800">
      <dt className="shrink-0 text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="break-all text-right text-zinc-800 dark:text-zinc-200">{value}</dd>
    </div>
  )
}

/** Fields worth promoting, in the order someone reads them. */
const CURATED: Array<{ key: string; label: string; date?: boolean }> = [
  { key: 'Title', label: 'Title' },
  { key: 'Author', label: 'Author' },
  { key: 'Subject', label: 'Subject' },
  { key: 'Keywords', label: 'Keywords' },
  { key: 'Creator', label: 'Created with' },
  { key: 'Producer', label: 'PDF producer' },
  { key: 'CreationDate', label: 'Created', date: true },
  { key: 'ModDate', label: 'Modified', date: true },
  { key: 'PDFFormatVersion', label: 'PDF version' },
]

export interface PdfPropertiesModalProps {
  open: boolean
  onClose: () => void
  meta: PdfDocumentInfo | null
  numPages: number
  firstPageSize: PageSize | undefined
}

/**
 * Document properties, on the shared `Modal` so Escape, the focus trap and the
 * scroll lock come for free rather than being re-implemented.
 *
 * <p>Rendered inside the viewer's subtree rather than portalled to the body: in
 * fullscreen the overlay establishes a stacking context, and this dialog has to
 * sit inside it to land above the pages.
 */
export function PdfPropertiesModal({
  open,
  onClose,
  meta,
  numPages,
  firstPageSize,
}: PdfPropertiesModalProps) {
  if (!open || !meta) return null

  const curated = CURATED.map(({ key, label, date }) => {
    const raw = meta.info[key]
    const value = date ? formatDate(raw) : asText(raw)
    return value ? { label, value } : null
  }).filter((r): r is { label: string; value: string } => r !== null)

  const shown = new Set(CURATED.map((c) => c.key))
  const rest = Object.entries(meta.info)
    .filter(([k, v]) => !shown.has(k) && !k.startsWith('_') && k !== 'raw' && asText(v) !== null)
    .map(([k, v]) => ({ label: k, value: asText(v) as string }))

  const pageSize = describePageSize(firstPageSize)

  return (
    <Modal open={open} onClose={onClose} title="Document properties" size="md">
      <dl className="text-xs">
        <Row label="Pages" value={String(numPages)} />
        {pageSize ? <Row label="Page size" value={pageSize} /> : null}
        <Row label="File size" value={formatBytes(meta.byteLength)} />
        {curated.map((r) => (
          <Row key={r.label} label={r.label} value={r.value} />
        ))}
      </dl>

      {rest.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
            All metadata ({rest.length})
          </summary>
          <dl className="mt-2 text-xs">
            {rest.map((r) => (
              <Row key={r.label} label={r.label} value={r.value} />
            ))}
          </dl>
        </details>
      ) : null}
    </Modal>
  )
}
