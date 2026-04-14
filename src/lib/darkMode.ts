/** Dark mode toggle — persists to localStorage, falls back to system preference. */

const STORAGE_KEY = 'agreemint-dark-mode'

export type DarkModeValue = 'light' | 'dark' | 'system'

let listeners: Set<() => void> = new Set()

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function resolvedIsDark(value: DarkModeValue): boolean {
  if (value === 'dark') return true
  if (value === 'light') return false
  return systemPrefersDark()
}

function applyToDocument(dark: boolean) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', dark)
}

/** Read the persisted preference (defaults to 'system'). */
export function getDarkModePreference(): DarkModeValue {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  } catch { /* private browsing */ }
  return 'system'
}

/** Set dark mode preference and apply immediately. */
export function setDarkModePreference(value: DarkModeValue) {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch { /* private browsing */ }
  applyToDocument(resolvedIsDark(value))
  listeners.forEach((fn) => fn())
}

/** Toggle between light → dark → system → light cycle. */
export function cycleDarkMode(): DarkModeValue {
  const cur = getDarkModePreference()
  const next: DarkModeValue = cur === 'light' ? 'dark' : cur === 'dark' ? 'system' : 'light'
  setDarkModePreference(next)
  return next
}

/** Apply the current preference to the document (call on app init). */
export function initDarkMode() {
  const pref = getDarkModePreference()
  applyToDocument(resolvedIsDark(pref))

  // Listen for system theme changes when in 'system' mode
  if (typeof window !== 'undefined') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getDarkModePreference() === 'system') {
        applyToDocument(systemPrefersDark())
        listeners.forEach((fn) => fn())
      }
    })
  }
}

/** Subscribe to dark mode changes (for React hooks). */
export function subscribeDarkMode(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
