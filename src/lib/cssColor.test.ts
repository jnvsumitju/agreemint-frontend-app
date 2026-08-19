import { describe, expect, it } from 'vitest'
import { normalizeHexInput, pickerHexFromCssColor } from './cssColor'

/**
 * What the custom-colour field accepts from a person typing into it.
 *
 * <p>Two callers with opposite needs, which is why there are two functions.
 * `<input type="color">` must be handed a six-digit hex no matter what, so
 * {@link pickerHexFromCssColor} substitutes a default. The text field has to be
 * able to REFUSE — an unparseable value must leave what the author typed on
 * screen so they can fix the typo, not silently become near-black.
 */
describe('hex input normalisation', () => {
  it('accepts a full six-digit hex', () => {
    expect(normalizeHexInput('#1a2b3c')).toBe('#1a2b3c')
  })

  it('expands the three-digit shorthand', () => {
    expect(normalizeHexInput('#abc')).toBe('#aabbcc')
    expect(normalizeHexInput('#f00')).toBe('#ff0000')
    expect(normalizeHexInput('#000')).toBe('#000000')
    expect(normalizeHexInput('#fff')).toBe('#ffffff')
  })

  it('lower-cases so the same colour compares equal', () => {
    // The palette check and the recent-colours list both match on the string,
    // so "#FF0000" and "#ff0000" must not be two different entries.
    expect(normalizeHexInput('#FF0000')).toBe('#ff0000')
    expect(normalizeHexInput('#ABC')).toBe('#aabbcc')
  })

  it('tolerates surrounding whitespace, which pasting tends to bring', () => {
    expect(normalizeHexInput('  #1a2b3c  ')).toBe('#1a2b3c')
    expect(normalizeHexInput('\t#abc\n')).toBe('#aabbcc')
  })

  it('rejects anything that is not a hex colour', () => {
    for (const bad of [
      '',
      '   ',
      '#',
      '#ab',
      '#abcd',
      '#abcde',
      '#abcdefa',
      '#ggg',
      '#12345g',
      'abc',
      '1a2b3c',
      'red',
      'rgb(255,0,0)',
      undefined,
      null,
    ]) {
      expect(normalizeHexInput(bad as string | undefined)).toBeNull()
    }
  })

  it('rejects a bare hex with no hash', () => {
    // Deliberate. "abc" is as likely to be the start of a word as a colour,
    // and the field shows a "#rrggbb" placeholder.
    expect(normalizeHexInput('aabbcc')).toBeNull()
  })

  // ── the picker wrapper ────────────────────────────────────────────────────

  it('the picker falls back to a default instead of failing', () => {
    // `<input type="color">` has no representation for "no value", so this one
    // must always return something valid.
    expect(pickerHexFromCssColor('not a colour')).toBe('#18181b')
    expect(pickerHexFromCssColor(undefined)).toBe('#18181b')
    expect(pickerHexFromCssColor('')).toBe('#18181b')
  })

  it('the picker expands shorthand the same way the field does', () => {
    // Both go through one implementation, so a value typed as shorthand and
    // the swatch beside it cannot disagree.
    expect(pickerHexFromCssColor('#abc')).toBe(normalizeHexInput('#abc'))
    expect(pickerHexFromCssColor('#1A2B3C')).toBe(normalizeHexInput('#1A2B3C'))
  })
})
