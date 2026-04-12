/**
 * Optional editor console diagnostics (band drag/resize, layers position).
 * Enable in production: `localStorage.setItem('AGREEMINT_EDITOR_DIAG', '1')` then reload.
 */

function diagnosticsEnabled(): boolean {
  try {
    if (import.meta.env.DEV) return true
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem('AGREEMINT_EDITOR_DIAG') === '1'
  } catch {
    return false
  }
}

const onceKeys = new Set<string>()

export function editorDiagLog(scope: string, message: string, detail?: Record<string, unknown>): void {
  if (!diagnosticsEnabled()) return
  if (detail !== undefined) console.info(`[agreemint:${scope}]`, message, detail)
  else console.info(`[agreemint:${scope}]`, message)
}

export function editorDiagLogOnce(
  key: string,
  scope: string,
  message: string,
  detail?: Record<string, unknown>
): void {
  if (!diagnosticsEnabled()) return
  if (onceKeys.has(key)) return
  onceKeys.add(key)
  editorDiagLog(scope, message, detail)
}
