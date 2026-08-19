import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseTemplateExportPayload } from './templateExport'
import { buildLayoutJson, PAGE_SIZE_PRESETS } from '../types/layout'
import { TRY_TEMPLATES } from './tryTemplates'

/**
 * Guards for the twenty prebuilt try-a-template bundles.
 *
 * <p>These are the only layouts in the product that ship as data rather than
 * being authored in the editor, so nothing else checks them. They are also the
 * most public thing we have — a broken one is a broken landing page.
 *
 * <p>The constraints below are not stylistic. Each is a place where the PDF
 * renderer fails *silently*: an unsupported page size becomes A4 without a
 * warning, and a formatting pipe renders as literal text in the finished
 * document. Neither shows up on the canvas, so a test is the only thing that
 * can catch them.
 */

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'try-templates')

/** Page sizes `PdfRendererService` actually honours; everything else → A4. */
const RENDERABLE_SIZES = ['A4', 'LETTER', 'A3', 'A5']

/** The renderer's own variable pattern, from `PdfRendererService:74`. */
const VAR = /\{\{([^}]*)}}/g

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'))
const bundles = files.map((file) => ({
  slug: file.replace(/\.json$/, ''),
  raw: JSON.parse(readFileSync(join(DIR, file), 'utf8')) as unknown,
}))

describe('try-template bundles', () => {
  it('has one bundle per catalogue entry, and no orphans', () => {
    expect([...bundles.map((b) => b.slug)].sort()).toEqual(
      [...TRY_TEMPLATES.map((t) => t.slug)].sort()
    )
  })

  it('files every template under the category its bundle declares', () => {
    // The same fact is written down three times — here, in the bundle (which
    // the backend seeder reads), and in the marketing page's frontmatter. The
    // bundle is the source; this asserts the catalogue has not drifted from it.
    //
    // Worth guarding because the failure is invisible: a template listed under
    // HR here and seeded as Business appears in one place on the hub and
    // another in the marketplace, and nothing errors.
    const byBundle = Object.fromEntries(
      bundles.map((b) => [b.slug, (b.raw as { category?: string }).category])
    )
    const mismatches = TRY_TEMPLATES.filter((t) => byBundle[t.slug] !== t.category).map(
      (t) => `${t.slug}: catalogue says ${t.category}, bundle says ${byBundle[t.slug]}`
    )
    expect(mismatches).toEqual([])
  })

  it('gives every bundle a category', () => {
    // Absent means the backend falls back to guessing from slug keywords, which
    // silently answers "Business" for anything it does not recognise.
    expect(
      bundles.filter((b) => !(b.raw as { category?: string }).category).map((b) => b.slug)
    ).toEqual([])
  })

  describe.each(bundles)('$slug', ({ raw }) => {
    const parsed = parseTemplateExportPayload(raw)

    it('saves without losing anything, and saving twice changes nothing', () => {
      // The same pairing that caught the `bezierPath` data loss: a serializer
      // and its parser are only correct together, and either half looks fine
      // alone. What a visitor needs is that clicking save cannot degrade the
      // template — so the property under test is that serialization reaches a
      // fixed point rather than that it is literally identity.
      //
      // It cannot be literal identity: `elementToJson` deliberately omits
      // fields that equal the parser's default (`tablePreviewBodyRows: 3` at
      // layout.ts:657, for one), so a bundle carrying a default value round
      // trips to `undefined` and back to the same default. That is a smaller
      // JSON payload, not a loss.
      const once = buildLayoutJson(parsed.pages, parsed.pageSpec, parsed.globalVariables)
      const reparsed = parseTemplateExportPayload(once)
      const twice = buildLayoutJson(reparsed.pages, reparsed.pageSpec, reparsed.globalVariables)

      expect(twice).toEqual(once)

      // Idempotence alone would be satisfied by a serializer that dropped the
      // same field every time, so also pin the things a template cannot afford
      // to lose even once.
      const before = parsed.pages.flatMap((p) => p.elements)
      const after = reparsed.pages.flatMap((p) => p.elements)
      expect(after.map((e) => [e.id, e.type, e.x, e.y, e.width, e.height])).toEqual(
        before.map((e) => [e.id, e.type, e.x, e.y, e.width, e.height])
      )
      expect(after.map((e) => e.content ?? null)).toEqual(before.map((e) => e.content ?? null))
      expect(after.map((e) => e.dataKey ?? null)).toEqual(before.map((e) => e.dataKey ?? null))
      expect(after.map((e) => e.columns ?? null)).toEqual(before.map((e) => e.columns ?? null))
      expect(after.map((e) => e.listItems ?? null)).toEqual(before.map((e) => e.listItems ?? null))
      expect(reparsed.pageSpec).toEqual(parsed.pageSpec)
      expect(reparsed.globalVariables).toEqual(parsed.globalVariables)
    })

    it('uses a page size the renderer honours', () => {
      expect(RENDERABLE_SIZES).toContain(parsed.pageSpec.size)
      // Belt and braces: a size that is in the presets but not in the renderer's
      // switch (LEGAL, TABLOID, B4…) looks right everywhere except the PDF.
      expect(PAGE_SIZE_PRESETS[parsed.pageSpec.size]).toBeDefined()
    })

    it('is portrait — the renderer never reads orientation', () => {
      expect(parsed.pageSpec.orientation ?? 'portrait').toBe('portrait')
    })

    it('has at least one page with content', () => {
      expect(parsed.pages.length).toBeGreaterThan(0)
      expect(parsed.pages[0].elements.length).toBeGreaterThan(0)
    })

    it('uses only element ids that are unique within the template', () => {
      const ids = parsed.pages.flatMap((p) => p.elements.map((e) => e.id))
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('uses no formatting pipes or expressions in variables', () => {
      const offenders: string[] = []
      const scan = (value: unknown): void => {
        if (typeof value === 'string') {
          for (const [, inner] of value.matchAll(VAR)) {
            // Anything the renderer's `[a-zA-Z0-9_.]+` would not match is
            // printed verbatim, braces and all, in the finished PDF.
            if (!/^\s*[a-zA-Z0-9_.]+\s*$/.test(inner)) offenders.push(`{{${inner}}}`)
          }
        } else if (Array.isArray(value)) {
          value.forEach(scan)
        } else if (value && typeof value === 'object') {
          Object.values(value).forEach(scan)
        }
      }
      scan(parsed.pages)
      expect(offenders).toEqual([])
    })

    it('supplies a sample value for every variable it declares', () => {
      // A placeholder rendering as raw `{{customer.name}}` on a public landing
      // page is the single most visible way one of these can look broken.
      const missing = parsed.globalVariables
        .map((v) => v.key)
        .filter((key) => !(key in parsed.variableValues))
      expect(missing).toEqual([])
    })

    it('gives every table a data key with parseable array rows', () => {
      const tables = parsed.pages.flatMap((p) => p.elements).filter((e) => e.type === 'TABLE')
      for (const t of tables) {
        expect(t.dataKey, `table ${t.id} has no dataKey`).toBeTruthy()
        const rows = JSON.parse(parsed.variableValues[t.dataKey!] ?? 'null') as unknown
        expect(Array.isArray(rows), `table ${t.id} sample data is not an array`).toBe(true)
        // Every column must resolve against the sample rows, or the preview
        // renders a column of blanks.
        for (const col of t.columns ?? []) {
          expect(
            (rows as Record<string, unknown>[]).some((r) => col.key in r),
            `table ${t.id} column "${col.key}" matches no sample row`
          ).toBe(true)
        }
      }
    })

    it('keeps every element inside the page', () => {
      const preset = PAGE_SIZE_PRESETS[parsed.pageSpec.size]
      for (const page of parsed.pages) {
        for (const el of page.elements) {
          expect(el.x, `${el.id} starts left of the page`).toBeGreaterThanOrEqual(0)
          expect(el.y, `${el.id} starts above the page`).toBeGreaterThanOrEqual(0)
          expect(el.x + el.width, `${el.id} overflows the right edge`).toBeLessThanOrEqual(preset.width)
          expect(el.y + el.height, `${el.id} overflows the bottom edge`).toBeLessThanOrEqual(preset.height)
        }
      }
    })
  })
})
