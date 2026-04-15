/**
 * Clipboard utilities for canvas element copy/paste.
 *
 * Serializes elements to JSON and uses the Clipboard API for cross-page
 * and (potentially) cross-tab paste.
 */

import type { LayoutElement } from '../types/layout'
import { newElementId } from '../types/layout'

const CLIPBOARD_PREFIX = '{"__agreemint_clipboard__":true,'

/** Copy elements to the system clipboard. */
export async function copyElementsToClipboard(elements: LayoutElement[]): Promise<void> {
  if (elements.length === 0) return
  const payload = JSON.stringify({
    __agreemint_clipboard__: true,
    elements,
  })
  try {
    await navigator.clipboard.writeText(payload)
  } catch {
    // Fallback: use execCommand (older browsers / non-HTTPS)
    const ta = document.createElement('textarea')
    ta.value = payload
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

/** Paste elements from the system clipboard, returning clones with new IDs and an offset. */
export async function pasteElementsFromClipboard(): Promise<LayoutElement[] | null> {
  try {
    const text = await navigator.clipboard.readText()
    return parseClipboardPayload(text)
  } catch {
    return null
  }
}

/** Parse clipboard text into elements (with fresh IDs + offset). */
function parseClipboardPayload(text: string): LayoutElement[] | null {
  if (!text.startsWith(CLIPBOARD_PREFIX)) return null
  try {
    const obj = JSON.parse(text)
    if (!obj?.__agreemint_clipboard__ || !Array.isArray(obj.elements)) return null
    const OFFSET = 10
    return (obj.elements as LayoutElement[]).map((el) => ({
      ...el,
      id: newElementId(),
      x: el.x + OFFSET,
      y: el.y + OFFSET,
      groupId: undefined,
    }))
  } catch {
    return null
  }
}
