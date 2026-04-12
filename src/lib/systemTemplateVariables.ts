import type { VariableDefinition } from '../types/layout'

/** Same rules as `normalizeCatalogVariableKey` in `types/layout.ts` (no runtime import from layout). */
function normCatalogKey(raw: string): string {
  const t = raw.trim().replace(/\s+/g, '_').replace(/[^\w.]/g, '')
  if (!t) return ''
  return /^[0-9]/.test(t) ? `_${t}` : t
}

/** Reserved global merge keys; not persisted in layout JSON `globalVariables`. */
export const SYSTEM_GLOBAL_VARIABLE_KEYS = ['totalPages', 'pageNumber'] as const

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
  ]
}

export function filterPersistableVariableDefinitions(defs: VariableDefinition[]): VariableDefinition[] {
  return defs.filter((d) => !isSystemGlobalVariableKey(d.key ?? ''))
}
