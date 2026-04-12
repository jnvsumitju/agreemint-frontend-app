/**
 * Rich-text / TipTap debug logging. In dev, logs are on by default.
 * In production, set `localStorage.setItem('agreemintDebugRichText', '1')` and reload.
 */
export function richTextDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (import.meta.env.DEV) return true
    return window.localStorage.getItem('agreemintDebugRichText') === '1'
  } catch {
    return import.meta.env.DEV
  }
}

export function richTextDebugLog(...args: unknown[]) {
  if (!richTextDebugEnabled()) return
  console.log('[agreemint-rich-debug]', ...args)
}
