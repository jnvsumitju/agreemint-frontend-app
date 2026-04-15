/**
 * Layout diff: compare two layout versions to show added/removed/changed elements.
 */

import type { LayoutElement, LayoutDocumentPage } from '../types/layout'

export interface ElementDiff {
  id: string
  type: 'added' | 'removed' | 'changed' | 'unchanged'
  element: LayoutElement
  /** For 'changed' entries, the previous version of the element. */
  previous?: LayoutElement
  /** For 'changed' entries, the list of property names that differ. */
  changedFields?: string[]
}

export interface PageDiff {
  pageId: string
  pageName: string
  elements: ElementDiff[]
  summary: {
    added: number
    removed: number
    changed: number
    unchanged: number
  }
}

/** Flatten all elements from all pages into a single map by ID. */
function elementMapFromPages(pages: LayoutDocumentPage[]): Map<string, LayoutElement> {
  const map = new Map<string, LayoutElement>()
  for (const page of pages) {
    for (const el of page.elements) {
      map.set(el.id, el)
    }
  }
  return map
}

/** Compare two element versions to find which top-level fields differ. */
function diffElementFields(a: LayoutElement, b: LayoutElement): string[] {
  const fields = new Set<string>()
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)])

  for (const key of allKeys) {
    const va = (a as unknown as Record<string, unknown>)[key]
    const vb = (b as unknown as Record<string, unknown>)[key]
    if (JSON.stringify(va) !== JSON.stringify(vb)) {
      fields.add(key)
    }
  }
  return [...fields].sort()
}

/** Diff two versions of the layout, comparing elements by ID. */
export function diffLayouts(
  oldPages: LayoutDocumentPage[],
  newPages: LayoutDocumentPage[]
): PageDiff[] {
  const oldMap = elementMapFromPages(oldPages)
  const newMap = elementMapFromPages(newPages)
  const allIds = new Set([...oldMap.keys(), ...newMap.keys()])

  const diffs: ElementDiff[] = []

  for (const id of allIds) {
    const oldEl = oldMap.get(id)
    const newEl = newMap.get(id)

    if (!oldEl && newEl) {
      diffs.push({ id, type: 'added', element: newEl })
    } else if (oldEl && !newEl) {
      diffs.push({ id, type: 'removed', element: oldEl })
    } else if (oldEl && newEl) {
      const changedFields = diffElementFields(oldEl, newEl)
      if (changedFields.length > 0) {
        diffs.push({ id, type: 'changed', element: newEl, previous: oldEl, changedFields })
      } else {
        diffs.push({ id, type: 'unchanged', element: newEl })
      }
    }
  }

  // Group by the page in the *new* layout (or old for removed elements)
  const pageMap = new Map<string, { pageId: string; pageName: string; elements: ElementDiff[] }>()

  for (const page of newPages) {
    pageMap.set(page.id, { pageId: page.id, pageName: page.name, elements: [] })
  }
  // Ensure old-only pages are represented
  for (const page of oldPages) {
    if (!pageMap.has(page.id)) {
      pageMap.set(page.id, { pageId: page.id, pageName: page.name + ' (removed)', elements: [] })
    }
  }

  for (const diff of diffs) {
    // Find which page this element belongs to
    let found = false
    for (const page of newPages) {
      if (page.elements.some((e) => e.id === diff.id)) {
        pageMap.get(page.id)!.elements.push(diff)
        found = true
        break
      }
    }
    if (!found) {
      for (const page of oldPages) {
        if (page.elements.some((e) => e.id === diff.id)) {
          pageMap.get(page.id)!.elements.push(diff)
          break
        }
      }
    }
  }

  return [...pageMap.values()].map((p) => ({
    ...p,
    summary: {
      added: p.elements.filter((e) => e.type === 'added').length,
      removed: p.elements.filter((e) => e.type === 'removed').length,
      changed: p.elements.filter((e) => e.type === 'changed').length,
      unchanged: p.elements.filter((e) => e.type === 'unchanged').length,
    },
  }))
}
