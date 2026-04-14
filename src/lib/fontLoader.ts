/** Font loading infrastructure for the template editor.
 *
 * Provides a curated list of web-safe + Google Fonts and on-demand loading
 * via dynamic `<link>` injection for Google Fonts.
 */

export type FontCategory = 'sans' | 'serif' | 'mono' | 'display'

export interface FontEntry {
  family: string
  category: FontCategory
  /** True for web-safe fonts that don't need network loading. */
  builtIn?: boolean
}

/** Curated font list: 10 web-safe + 20 Google Fonts. */
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
  { family: 'Inter', category: 'sans' },
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
  { family: 'JetBrains Mono', category: 'mono' },
  { family: 'Source Code Pro', category: 'mono' },
  { family: 'Oswald', category: 'display' },
  { family: 'Bebas Neue', category: 'display' },
]

const loadedFonts = new Set<string>()
const loadingFonts = new Map<string, Promise<void>>()

/**
 * Load a Google Font by family name. Injects a `<link>` stylesheet into `<head>`.
 * Web-safe fonts resolve immediately. Duplicate requests are deduped.
 */
export function loadFont(family: string): Promise<void> {
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
  const entry = FONT_LIST.find((f) => f.family === family)
  if (!entry) return false
  if (entry.builtIn) return true
  return loadedFonts.has(family)
}

/** Get all font families as a flat string array (for dropdowns, etc.). */
export function allFontFamilies(): string[] {
  return FONT_LIST.map((f) => f.family)
}

/** Find the FontEntry for a family name (case-sensitive match). */
export function findFontEntry(family: string): FontEntry | undefined {
  return FONT_LIST.find((f) => f.family === family)
}
