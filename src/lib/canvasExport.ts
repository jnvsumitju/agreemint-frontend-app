/**
 * Export canvas page as PNG or JPEG image.
 * Uses html-to-image to capture the rendered page div.
 */

import { toPng, toJpeg } from 'html-to-image'

export type ImageFormat = 'png' | 'jpeg'

/**
 * Capture a DOM element as a PNG or JPEG blob and trigger a download.
 *
 * @param element   The page container element to capture (typically the canvas page div)
 * @param filename  Download filename (without extension)
 * @param format    'png' or 'jpeg'
 * @param scale     Pixel density multiplier (default 2 for retina)
 */
export async function exportElementAsImage(
  element: HTMLElement,
  filename: string,
  format: ImageFormat = 'png',
  scale = 2
): Promise<void> {
  const options = {
    pixelRatio: scale,
    cacheBust: true,
    // Skip elements that shouldn't be in the export (guides, selection rings, etc.)
    filter: (node: HTMLElement) => {
      if (node.dataset?.agExportSkip === 'true') return false
      if (node.classList?.contains('ring-violet-500')) return false
      return true
    },
  }

  const dataUrl = format === 'jpeg'
    ? await toJpeg(element, { ...options, quality: 0.92 })
    : await toPng(element, options)

  // Trigger download
  const ext = format === 'jpeg' ? 'jpg' : 'png'
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = `${filename}.${ext}`
  link.rel = 'noopener'
  link.click()
}
