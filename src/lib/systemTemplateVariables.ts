import type { VariableDefinition } from '../types/layout'

/** Same rules as `normalizeCatalogVariableKey` in `types/layout.ts` (no runtime import from layout). */
function normCatalogKey(raw: string): string {
  const t = raw.trim().replace(/\s+/g, '_').replace(/[^\w.]/g, '')
  if (!t) return ''
  return /^[0-9]/.test(t) ? `_${t}` : t
}

/**
 * Reserved global merge keys. These are computed by the backend at render
 * time (or the editor at preview time) — the template author can
 * reference them from text / rules, but shouldn't be able to supply a
 * value for them. They're:
 *   - excluded from persistence in layout JSON `globalVariables`
 *     ({@link filterPersistableVariableDefinitions})
 *   - stripped from the `data` payload sent to `/api/generate/preview`
 *     and `/api/generate` ({@link stripSystemVariableKeysFromData})
 *   - still exposed to the `@`-mention + rule-condition dropdowns so
 *     authors can insert them
 */
export const SYSTEM_GLOBAL_VARIABLE_KEYS = [
  'totalPages',
  'pageNumber',
  'currentDate',
] as const

export function isSystemGlobalVariableKey(rawOrNormalizedKey: string): boolean {
  const nk = normCatalogKey(rawOrNormalizedKey)
  if (!nk) return false
  return (SYSTEM_GLOBAL_VARIABLE_KEYS as readonly string[]).includes(nk)
}

/** Catalog rows shown read-only in the Variables tab (descriptions only). */
export function systemGlobalVariableDefinitions(): VariableDefinition[] {
  return [
    {
      key: 'totalPages',
      description:
        'Built-in: total pages in this layout. Always matches the real page count in preview and PDF (not editable).',
    },
    {
      key: 'pageNumber',
      description:
        'Built-in: current page number (1-based). In the editor this follows the active page; in PDF export it is set per printed page.',
    },
    {
      key: 'currentDate',
      description:
        'Built-in: the date the PDF is generated (backend-provided). Not something the author or API caller supplies.',
    },
  ]
}

export function filterPersistableVariableDefinitions(defs: VariableDefinition[]): VariableDefinition[] {
  return defs.filter((d) => !isSystemGlobalVariableKey(d.key ?? ''))
}

/**
 * Strip reserved system keys from a `data` payload on its way to the
 * preview / generate PDF endpoints. The backend computes its own values
 * for these at render time, so anything the client sends is discarded —
 * leaving them in the payload just creates misleading noise when users
 * inspect the request in devtools / cURL.
 *
 * Matches both raw keys (`pageNumber`) and their normalised form so we
 * don't miss author-supplied variants like `"Page Number"` (which
 * normalises to `Page_Number`, still stripped if it ever collides).
 */
export function stripSystemVariableKeysFromData<T extends Record<string, unknown>>(
  data: T | undefined,
): Record<string, unknown> {
  if (!data) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (isSystemGlobalVariableKey(k)) continue
    out[k] = v
  }
  return out
}
