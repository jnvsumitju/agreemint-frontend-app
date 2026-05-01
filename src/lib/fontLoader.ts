/** Font loading infrastructure for the template editor.
 *
 * Two modes, switched at runtime by `pixelParityEnabled()`:
 *
 * - **Legacy** (default through phases 0-4): 10 web-safe + 20 Google Fonts,
 *   loaded on demand by injecting a `<link>` into `<head>`.
 * - **Pixel-parity**: narrowed to the three families the backend ships TTFs
 *   for (Inter / Source Serif 4 / JetBrains Mono). No network load — the
 *   `@font-face` rules in `index.css` point at `/public/fonts/*.woff2` which
 *   Vite serves from the same origin. Canvas and PDF now draw from identical
 *   font bytes. Non-parity families surface as disabled in the dropdown.
 */

import { pixelParityEnabled, PARITY_FONT_FAMILIES, isParityFontFamily } from './features'
export { coerceToSupportedFamily } from './features'

export type FontCategory = 'sans' | 'serif' | 'mono' | 'display'

export interface FontEntry {
  family: string
  category: FontCategory
  /** True for web-safe fonts that don't need network loading. */
  builtIn?: boolean
  /** True when a matching TTF is bundled by the backend `PdfFontRegistry`. */
  parity?: boolean
}

/** Curated font list used when the pixel-parity flag is off. */
export const FONT_LIST: readonly FontEntry[] = [
  // ── Web-safe (always available) ──
  { family: 'Arial', category: 'sans', builtIn: true },
  { family: 'Helvetica', category: 'sans', builtIn: true },
  { family: 'Times New Roman', category: 'serif', builtIn: true },
  { family: 'Georgia', category: 'serif', builtIn: true },
  { family: 'Courier New', category: 'mono', builtIn: true },
  { family: 'Verdana', category: 'sans', builtIn: true },
  { family: 'Trebuchet MS', category: 'sans', builtIn: true },
  { family: 'Palatino', category: 'serif', builtIn: true },
  { family: 'Impact', category: 'display', builtIn: true },
  { family: 'Lucida Console', category: 'mono', builtIn: true },

  // ── Google Fonts (loaded on demand) ──
  { family: 'Inter', category: 'sans', parity: true },
  { family: 'Roboto', category: 'sans' },
  { family: 'Open Sans', category: 'sans' },
  { family: 'Lato', category: 'sans' },
  { family: 'Poppins', category: 'sans' },
  { family: 'Nunito', category: 'sans' },
  { family: 'Montserrat', category: 'sans' },
  { family: 'Raleway', category: 'sans' },
  { family: 'Source Sans 3', category: 'sans' },
  { family: 'Merriweather', category: 'serif' },
  { family: 'Playfair Display', category: 'serif' },
  { family: 'Lora', category: 'serif' },
  { family: 'PT Serif', category: 'serif' },
  { family: 'Libre Baskerville', category: 'serif' },
  { family: 'Roboto Mono', category: 'mono' },
  { family: 'Fira Code', category: 'mono' },
  { family: 'JetBrains Mono', category: 'mono', parity: true },
  { family: 'Source Code Pro', category: 'mono' },
  { family: 'Oswald', category: 'display' },
  { family: 'Bebas Neue', category: 'display' },
]

/** The narrowed list used when pixel-parity is on. Backend `PdfFontRegistry` must embed these. */
export const PARITY_FONT_LIST: readonly FontEntry[] = [
  { family: PARITY_FONT_FAMILIES.sans,  category: 'sans',  parity: true },
  { family: PARITY_FONT_FAMILIES.serif, category: 'serif', parity: true },
  { family: PARITY_FONT_FAMILIES.mono,  category: 'mono',  parity: true },
]

const loadedFonts = new Set<string>()
const loadingFonts = new Map<string, Promise<void>>()

/**
 * Load a font by family name.
 *
 * Pixel-parity mode: the three curated families are pre-declared via
 * `@font-face` in `index.css`; this call resolves once the browser reports
 * the font ready via `document.fonts`. Non-parity families resolve as a
 * no-op so callers can keep the same API.
 *
 * Legacy mode: web-safe families resolve immediately; Google Fonts inject a
 * `<link>` stylesheet with `display=swap`. Duplicate requests are deduped.
 */
export function loadFont(family: string): Promise<void> {
  if (pixelParityEnabled()) {
    if (!isParityFontFamily(family)) {
      return Promise.resolve()
    }
    if (loadedFonts.has(family)) return Promise.resolve()
    const existing = loadingFonts.get(family)
    if (existing) return existing
    const promise = (document.fonts?.ready ?? Promise.resolve()).then(() => {
      loadedFonts.add(family)
      loadingFonts.delete(family)
    })
    loadingFonts.set(family, promise)
    return promise
  }

  const entry = FONT_LIST.find((f) => f.family === family)
  if (!entry || entry.builtIn) return Promise.resolve()
  if (loadedFonts.has(family)) return Promise.resolve()

  const existing = loadingFonts.get(family)
  if (existing) return existing

  const promise = new Promise<void>((resolve) => {
    const encoded = family.replace(/ /g, '+')
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${encoded}:ital,wght@0,400;0,700;1,400;1,700&display=swap`
    link.onload = () => {
      loadedFonts.add(family)
      loadingFonts.delete(family)
      resolve()
    }
    link.onerror = () => {
      loadingFonts.delete(family)
      resolve() // resolve anyway — falls back to system font
    }
    document.head.appendChild(link)
  })

  loadingFonts.set(family, promise)
  return promise
}

/** Check whether a font is ready to use (built-in or already loaded). */
export function isFontLoaded(family: string): boolean {
  if (pixelParityEnabled()) {
    return isParityFontFamily(family) && loadedFonts.has(family)
  }
  const entry = FONT_LIST.find((f) => f.family === family)
  if (!entry) return false
  if (entry.builtIn) return true
  return loadedFonts.has(family)
}

/** Get all font families as a flat string array (for dropdowns, etc.). */
export function allFontFamilies(): string[] {
  if (pixelParityEnabled()) {
    return PARITY_FONT_LIST.map((f) => f.family)
  }
  return FONT_LIST.map((f) => f.family)
}

/** Find the FontEntry for a family name (case-sensitive match). */
export function findFontEntry(family: string): FontEntry | undefined {
  const list = pixelParityEnabled() ? PARITY_FONT_LIST : FONT_LIST
  return list.find((f) => f.family === family)
}

