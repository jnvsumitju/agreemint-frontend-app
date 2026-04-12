/** Value suitable for `<input type="color" />` (must be #rrggbb). */
export function pickerHexFromCssColor(value: string | undefined): string {
  if (!value || typeof value !== 'string') return '#18181b'
  const t = value.trim()
  if (/^#[0-9A-Fa-f]{6}$/.test(t)) return t
  if (/^#[0-9A-Fa-f]{3}$/.test(t)) {
    return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`
  }
  return '#18181b'
}
