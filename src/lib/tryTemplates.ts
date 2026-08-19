/**
 * Prebuilt templates anyone can open and edit without an account, at
 * `/try/:slug`. Each one is promoted by a page on the marketing site
 * (`crixaa.com/templates/<same-slug>`), so the slug is the shared identifier
 * between the two apps — keep them in step.
 *
 * <p>The bundles are resolved through `import.meta.glob` rather than served
 * from `public/`. Files in `public/` ship without a content hash, so a
 * corrected template can serve stale from a browser or CDN cache for as long as
 * that cache lives; and `vercel.json` rewrites every unmatched path to
 * `index.html`, so a slug typo would hand `<!doctype html>` to `JSON.parse` and
 * take the whole route down with it. Glob imports give one content-hashed chunk
 * per template, fetched on demand, and an unknown slug is simply a missing key.
 * Adding a template needs a frontend deploy either way, since the file lives in
 * this repo — so nothing is traded away for it.
 */

import { parseTemplateExportPayload, type ParsedTemplatePayload } from './templateExport'

export type TryTemplateCategory = 'Finance' | 'HR' | 'Education' | 'Business' | 'Legal'

export interface TryTemplateMeta {
  slug: string
  /** Shown in the toolbar and used as the template name when it is claimed. */
  name: string
  category: TryTemplateCategory
}

/**
 * The catalogue, in the order the marketing hub lists them.
 *
 * <p>Held separately from the bundles so a page can render its title and
 * category before the (lazily fetched) layout chunk has resolved.
 */
export const TRY_TEMPLATES: readonly TryTemplateMeta[] = [
  // Finance
  { slug: 'free-invoice-template', name: 'Invoice', category: 'Finance' },
  { slug: 'free-gst-invoice-template', name: 'GST Invoice', category: 'Finance' },
  { slug: 'free-receipt-template', name: 'Receipt', category: 'Finance' },
  { slug: 'free-quotation-template', name: 'Quotation', category: 'Finance' },
  { slug: 'free-purchase-order-template', name: 'Purchase Order', category: 'Finance' },
  // HR
  { slug: 'free-offer-letter-template', name: 'Offer Letter', category: 'HR' },
  { slug: 'free-experience-certificate-template', name: 'Experience Certificate', category: 'HR' },
  { slug: 'free-salary-slip-template', name: 'Salary Slip', category: 'HR' },
  { slug: 'free-joining-letter-template', name: 'Joining Letter', category: 'HR' },
  { slug: 'free-relieving-letter-template', name: 'Relieving Letter', category: 'HR' },
  // Education
  { slug: 'free-course-certificate-template', name: 'Course Certificate', category: 'Education' },
  { slug: 'free-achievement-certificate-template', name: 'Achievement Certificate', category: 'Education' },
  { slug: 'free-marksheet-template', name: 'Marksheet', category: 'Education' },
  { slug: 'free-id-card-template', name: 'ID Card', category: 'Education' },
  { slug: 'free-admit-card-template', name: 'Admit Card', category: 'Education' },
  // Business
  { slug: 'free-contract-template', name: 'Contract', category: 'Business' },
  { slug: 'free-nda-template', name: 'NDA', category: 'Business' },
  { slug: 'free-business-proposal-template', name: 'Business Proposal', category: 'Business' },
  { slug: 'free-report-template', name: 'Report', category: 'Business' },
  { slug: 'free-statement-template', name: 'Statement', category: 'Business' },

  // Finance
  { slug: 'free-proforma-invoice-template', name: 'Proforma Invoice', category: 'Finance' },
  { slug: 'free-credit-note-template', name: 'Credit Note', category: 'Finance' },
  { slug: 'free-debit-note-template', name: 'Debit Note', category: 'Finance' },
  { slug: 'free-delivery-challan-template', name: 'Delivery Challan', category: 'Finance' },
  { slug: 'free-petty-cash-voucher-template', name: 'Petty Cash Voucher', category: 'Finance' },
  { slug: 'free-expense-report-template', name: 'Expense Report', category: 'Finance' },
  // HR
  { slug: 'free-appointment-letter-template', name: 'Appointment Letter', category: 'HR' },
  { slug: 'free-internship-certificate-template', name: 'Internship Certificate', category: 'HR' },
  { slug: 'free-resignation-acceptance-letter-template', name: 'Resignation Acceptance Letter', category: 'HR' },
  { slug: 'free-warning-letter-template', name: 'Warning Letter', category: 'HR' },
  { slug: 'free-promotion-letter-template', name: 'Promotion Letter', category: 'HR' },
  { slug: 'free-timesheet-template', name: 'Timesheet', category: 'HR' },
  // Education
  { slug: 'free-bonafide-certificate-template', name: 'Bonafide Certificate', category: 'Education' },
  { slug: 'free-transfer-certificate-template', name: 'Transfer Certificate', category: 'Education' },
  { slug: 'free-character-certificate-template', name: 'Character Certificate', category: 'Education' },
  { slug: 'free-attendance-register-template', name: 'Attendance Register', category: 'Education' },
  { slug: 'free-fee-receipt-template', name: 'Fee Receipt', category: 'Education' },
  // Business
  { slug: 'free-meeting-minutes-template', name: 'Meeting Minutes', category: 'Business' },
  { slug: 'free-sow-template', name: 'SOW', category: 'Business' },
  { slug: 'free-business-plan-template', name: 'Business Plan', category: 'Business' },
  { slug: 'free-price-list-template', name: 'Price List', category: 'Business' },
  { slug: 'free-packing-list-template', name: 'Packing List', category: 'Business' },
  { slug: 'free-letterhead-template', name: 'Letterhead', category: 'Business' },
  // Legal
  { slug: 'free-rent-agreement-template', name: 'Rent Agreement', category: 'Legal' },
  { slug: 'free-affidavit-template', name: 'Affidavit', category: 'Legal' },
  { slug: 'free-power-of-attorney-template', name: 'Power of Attorney', category: 'Legal' },
  { slug: 'free-mou-template', name: 'MoU', category: 'Legal' },
  { slug: 'free-partnership-deed-template', name: 'Partnership Deed', category: 'Legal' },
  { slug: 'free-consultancy-agreement-template', name: 'Consultancy Agreement', category: 'Legal' },
  { slug: 'free-loan-agreement-template', name: 'Loan Agreement', category: 'Legal' },
]

export function getTryTemplateMeta(slug: string): TryTemplateMeta | null {
  return TRY_TEMPLATES.find((t) => t.slug === slug) ?? null
}

/**
 * Where to send someone who wants to browse the rest of the templates.
 *
 * <p>The gallery lives on the marketing site, not in the console — every
 * console route needs a session, which is the one thing a try-visitor does not
 * have. Sending them to `/templates` here would bounce them to `/login`.
 */
export const TEMPLATE_GALLERY_URL: string = `${
  import.meta.env.VITE_MARKETING_URL || 'https://crixaa.com'
}/templates`

/** Prefix marking a template id that exists only in this browser tab. */
export const TRY_TEMPLATE_ID_PREFIX = 'try:'

/**
 * The id a sandbox session reports as `templateId`.
 *
 * <p>The editor needs *a* template id — `EditorCanvas` reads it from the store
 * to key Yjs fragments — but there is no row behind this one. The prefix makes
 * that unmistakable in any log line or storage key it ends up in.
 */
export function syntheticTemplateId(slug: string): string {
  return `${TRY_TEMPLATE_ID_PREFIX}${slug}`
}

export function isSyntheticTemplateId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(TRY_TEMPLATE_ID_PREFIX)
}

const bundles = import.meta.glob<{ default: unknown }>('../try-templates/*.json')

function bundleKey(slug: string): string {
  return `../try-templates/${slug}.json`
}

export class UnknownTryTemplateError extends Error {
  constructor(slug: string) {
    super(`No template named "${slug}".`)
    this.name = 'UnknownTryTemplateError'
  }
}

/**
 * Load and parse a try-template bundle.
 *
 * <p>Deliberately not `authFetch`: that attaches whatever `Authorization`
 * header is lying around and, on a 401, logs the user out and hard-navigates to
 * `/login` — which from inside the sandbox would throw away the visitor's
 * unsaved work. Nothing on this path talks to the API at all.
 */
export async function loadTryTemplate(slug: string): Promise<ParsedTemplatePayload> {
  const load = bundles[bundleKey(slug)]
  if (!load) throw new UnknownTryTemplateError(slug)
  const mod = await load()
  return parseTemplateExportPayload(mod.default)
}
