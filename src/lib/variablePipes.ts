/**
 * Variable formatting pipes.
 *
 * Syntax: `{{key | pipe:"arg" | pipe2:arg2}}`
 *
 * Built-in pipes:
 *   currency       – format as USD currency ($1,234.56)
 *   number:N       – format with N decimal places
 *   date:"fmt"     – format date string (basic: YYYY, MM, DD, MMM)
 *   uppercase      – convert to UPPER CASE
 *   lowercase      – convert to lower case
 *   capitalize     – Capitalize Each Word
 *   truncate:N     – truncate to N characters + "…"
 *   default:"val"  – fallback when value is empty/missing
 */

export interface ParsedVariable {
  key: string
  pipes: { name: string; arg?: string }[]
}

/**
 * Extended regex for `{{key}}` or `{{key | pipe:"arg" | pipe2}}`.
 * Captures the full inner expression (key + optional pipes).
 */
export const VAR_PIPE_RE = /\{\{\s*([a-zA-Z0-9_.]+)((?:\s*\|\s*[^}]+)?)\s*\}\}/g

/** Parse a full variable expression (the part inside `{{ }}`) into key + pipes. */
export function parseVariableExpression(inner: string): ParsedVariable {
  const parts = inner.split('|').map((s) => s.trim())
  const key = parts[0]
  const pipes = parts.slice(1).map((p) => {
    const colonIdx = p.indexOf(':')
    if (colonIdx === -1) return { name: p }
    const name = p.slice(0, colonIdx).trim()
    let arg = p.slice(colonIdx + 1).trim()
    // Strip surrounding quotes from argument
    if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
      arg = arg.slice(1, -1)
    }
    return { name, arg }
  })
  return { key, pipes }
}

/** Strip pipe expressions from a key string to get the base variable name. */
export function stripPipesFromKey(fullExpr: string): string {
  const pipeIdx = fullExpr.indexOf('|')
  return pipeIdx === -1 ? fullExpr.trim() : fullExpr.slice(0, pipeIdx).trim()
}

/** Apply a chain of pipes to a resolved value. */
export function applyPipes(
  value: unknown,
  pipes: { name: string; arg?: string }[]
): string {
  let result = value

  for (const pipe of pipes) {
    result = applyOnePipe(result, pipe.name, pipe.arg)
  }

  // Final coercion to string
  if (result == null) return ''
  return String(result)
}

function applyOnePipe(value: unknown, pipeName: string, arg?: string): unknown {
  const str = value != null ? String(value) : ''
  const isEmpty = str.trim() === ''

  switch (pipeName) {
    case 'default':
      return isEmpty ? (arg ?? '') : value

    case 'uppercase':
      return str.toUpperCase()

    case 'lowercase':
      return str.toLowerCase()

    case 'capitalize':
      return str.replace(/\b\w/g, (c) => c.toUpperCase())

    case 'truncate': {
      const max = parseInt(arg ?? '50', 10)
      return str.length > max ? str.slice(0, max) + '\u2026' : str
    }

    case 'number': {
      const n = parseFloat(str)
      if (!Number.isFinite(n)) return str
      const decimals = parseInt(arg ?? '2', 10)
      return n.toFixed(decimals)
    }

    case 'currency': {
      const n = parseFloat(str)
      if (!Number.isFinite(n)) return str
      try {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: arg || 'USD',
        }).format(n)
      } catch {
        return `$${n.toFixed(2)}`
      }
    }

    case 'date': {
      if (isEmpty) return ''
      try {
        const d = new Date(str)
        if (isNaN(d.getTime())) return str
        const fmt = arg || 'YYYY-MM-DD'
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        return fmt
          .replace('YYYY', String(d.getFullYear()))
          .replace('MM', String(d.getMonth() + 1).padStart(2, '0'))
          .replace('MMM', months[d.getMonth()])
          .replace('DD', String(d.getDate()).padStart(2, '0'))
      } catch {
        return str
      }
    }

    default:
      return value // unknown pipe — pass through
  }
}

/**
 * Substitute a template string, applying pipes.
 * `resolve` is called with the bare key and returns the raw value.
 */
export function substituteWithPipes(
  template: string,
  resolve: (key: string) => unknown
): string {
  if (!template) return ''
  return template.replace(VAR_PIPE_RE, (_, keyPart: string, pipePart: string) => {
    const fullExpr = keyPart + (pipePart || '')
    const parsed = parseVariableExpression(fullExpr)
    const rawValue = resolve(parsed.key)
    if (parsed.pipes.length === 0) {
      // No pipes — original behavior
      if (rawValue == null) return ''
      if (typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean') return String(rawValue)
      try { return JSON.stringify(rawValue) } catch { return '' }
    }
    return applyPipes(rawValue, parsed.pipes)
  })
}
