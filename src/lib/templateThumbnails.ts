/**
 * localStorage-backed template thumbnail store.
 * Thumbnails are small PNG data-URLs captured from the editor canvas.
 * Keyed by templateId. Limited to prevent localStorage bloat.
 */

import { toPng } from 'html-to-image'

const STORAGE_KEY = 'agreemint-template-thumbnails'
const MAX_THUMBNAILS = 50

type ThumbnailMap = Record<string, { dataUrl: string; updatedAt: string }>

function readMap(): ThumbnailMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as ThumbnailMap
  } catch {
    return {}
  }
}

function writeMap(map: ThumbnailMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

/** Get the thumbnail data URL for a template, or null. */
export function getTemplateThumbnail(templateId: string): string | null {
  return readMap()[templateId]?.dataUrl ?? null
}

/** Save a thumbnail data URL for a template. Evicts oldest if over limit. */
export function setTemplateThumbnail(templateId: string, dataUrl: string): void {
  const map = readMap()
  map[templateId] = { dataUrl, updatedAt: new Date().toISOString() }

  // Evict oldest if over limit
  const keys = Object.keys(map)
  if (keys.length > MAX_THUMBNAILS) {
    const sorted = keys.sort((a, b) => {
      const ta = map[a]?.updatedAt ?? ''
      const tb = map[b]?.updatedAt ?? ''
      return ta.localeCompare(tb)
    })
    for (let i = 0; i < keys.length - MAX_THUMBNAILS; i++) {
      delete map[sorted[i]]
    }
  }
  writeMap(map)
}

/** Remove thumbnail for a template. */
export function clearTemplateThumbnail(templateId: string): void {
  const map = readMap()
  delete map[templateId]
  writeMap(map)
}

/** Get all thumbnails (for gallery display). */
export function getAllThumbnails(): Record<string, string> {
  const map = readMap()
  const result: Record<string, string> = {}
  for (const [id, entry] of Object.entries(map)) {
    result[id] = entry.dataUrl
  }
  return result
}

/**
 * Capture a thumbnail from the editor canvas page element.
 * Uses html-to-image at a very small scale for storage efficiency.
 * Returns a small PNG data URL.
 */
export async function captureCanvasThumbnail(): Promise<string | null> {
  const pageEl = document.querySelector<HTMLElement>('[data-agreemint-page-canvas]')
  if (!pageEl) return null
  try {
    const dataUrl = await toPng(pageEl, {
      pixelRatio: 0.3,
      cacheBust: true,
      filter: (node: HTMLElement) => {
        if (node.dataset?.agExportSkip === 'true') return false
        if (node.classList?.contains('ring-violet-500')) return false
        return true
      },
    })
    return dataUrl
  } catch {
    return null
  }
}
