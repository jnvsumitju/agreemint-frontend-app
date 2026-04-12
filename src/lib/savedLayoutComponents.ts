import type { LayoutElement } from '../types/layout'

export const LAYOUT_COMPONENTS_STORAGE_KEY = 'agreemint.layoutComponents.v1'

export interface SavedLayoutComponent {
  id: string
  name: string
  /** Positions relative to the selection bounding box top-left. */
  elements: LayoutElement[]
}

export function loadLayoutComponentsFromStorage(): SavedLayoutComponent[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(LAYOUT_COMPONENTS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: SavedLayoutComponent[] = []
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue
      const o = row as Record<string, unknown>
      const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : null
      const name = typeof o.name === 'string' ? o.name.trim() : ''
      const els = o.elements
      if (!id || !name || !Array.isArray(els) || els.length === 0) continue
      out.push({
        id,
        name,
        elements: els as LayoutElement[],
      })
    }
    return out
  } catch {
    return []
  }
}

export function persistLayoutComponents(components: SavedLayoutComponent[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LAYOUT_COMPONENTS_STORAGE_KEY, JSON.stringify(components))
  } catch {
    /* quota or private mode */
  }
}
