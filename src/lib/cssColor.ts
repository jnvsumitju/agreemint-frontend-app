/**
 * Canonical `#rrggbb` for a hex colour a person typed, or null if it isn't one.
 *
 * <p>Accepts the three-digit shorthand and expands it, and lower-cases the
 * result so two spellings of the same colour compare equal — the recent-colours
 * list and the palette both match on the string.
 *
 * <p>Returns null rather than a fallback so callers can tell "not a colour"
 * from "the colour they typed". {@link pickerHexFromCssColor} needs a value for
 * every input and supplies the default itself; a field that has to reject bad
 * input needs to know it was bad.
 */
export function normalizeHexInput(value: string | undefined | null): string | null {
  if (!value || typeof value !== 'string') return null
  const t = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(t)) return t
  if (/^#[0-9a-f]{3}$/.test(t)) {
    return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`
  }
  return null
}

/** Value suitable for `<input type="color" />` (must be #rrggbb). */
export function pickerHexFromCssColor(value: string | undefined): string {
  return normalizeHexInput(value) ?? '#18181b'
}
