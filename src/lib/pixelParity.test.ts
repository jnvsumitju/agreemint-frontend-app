import { describe, it, expect } from 'vitest'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

import { pixelParityEnabled, PARITY_FONT_FAMILIES, isParityFontFamily, DEFAULT_FONT_FAMILY, coerceToSupportedFamily } from './features'
import { allFontFamilies, coerceToSupportedFamily as coerce2 } from './fontLoader'

/**
 * Phase-0 smoke tests.
 *
 * Locks the parity-flag contract so the backend measurement endpoint and the
 * canvas can rely on a known default state:
 *
 *   - Flag defaults OFF (no `VITE_FEATURE_PIXEL_PARITY` env in vitest).
 *   - `Inter` is the canvas + PDF default sans family.
 *   - Non-parity families are coerced to the default when the flag is on, left
 *     alone when it's off.
 *
 * Also exercises the pixelmatch + pngjs image-diff path — the real parity
 * comparator in phase 1+ relies on it, so any install / API break surfaces here.
 */
describe('pixel-parity feature flag', () => {
  it('is on by default (phase 5)', () => {
    // Phase-5 rollout: default ON. `VITE_FEATURE_PIXEL_PARITY` is undefined
    // in vitest's env, which now resolves to enabled.
    expect(pixelParityEnabled()).toBe(true)
  })

  it('exposes the three embedded families', () => {
    expect(PARITY_FONT_FAMILIES.sans).toBe('Inter')
    expect(PARITY_FONT_FAMILIES.serif).toBe('Source Serif 4')
    expect(PARITY_FONT_FAMILIES.mono).toBe('JetBrains Mono')
    expect(DEFAULT_FONT_FAMILY).toBe('Inter')
  })

  it('recognises only the shipped families as parity-supported', () => {
    expect(isParityFontFamily('Inter')).toBe(true)
    expect(isParityFontFamily('Source Serif 4')).toBe(true)
    expect(isParityFontFamily('JetBrains Mono')).toBe(true)
    expect(isParityFontFamily('Roboto')).toBe(false)
    expect(isParityFontFamily('Arial')).toBe(false)
    expect(isParityFontFamily(undefined)).toBe(false)
  })

  it('coerces legacy families to the default sans when the flag is on', () => {
    // Phase-5 default ON: anything not in the curated parity list is remapped
    // to Inter so canvas + PDF render with identical glyph bytes.
    expect(coerceToSupportedFamily('Arial')).toBe('Inter')
    expect(coerceToSupportedFamily('Roboto')).toBe('Inter')
    expect(coerceToSupportedFamily('Inter')).toBe('Inter')
    expect(coerceToSupportedFamily('Source Serif 4')).toBe('Source Serif 4')
    expect(coerceToSupportedFamily(undefined)).toBe('Inter')
    expect(coerce2('Arial')).toBe('Inter')
  })

  it('fontLoader narrows to the three curated families when the flag is on', () => {
    const families = allFontFamilies()
    expect(families).toEqual(['Inter', 'Source Serif 4', 'JetBrains Mono'])
  })
})

describe('pixelmatch image diff wiring', () => {
  it('reports zero diff between two identical buffers', () => {
    const width = 8
    const height = 8
    const a = Buffer.alloc(width * height * 4, 0xff)
    const b = Buffer.alloc(width * height * 4, 0xff)
    const diff = Buffer.alloc(width * height * 4)
    const mismatched = pixelmatch(a, b, diff, width, height, { threshold: 0.1 })
    expect(mismatched).toBe(0)
  })

  it('round-trips a PNG buffer through pngjs', () => {
    const width = 4
    const height = 4
    const png = new PNG({ width, height })
    png.data.fill(0xff)
    const buf = PNG.sync.write(png)
    const parsed = PNG.sync.read(buf)
    expect(parsed.width).toBe(width)
    expect(parsed.height).toBe(height)
    expect(parsed.data.length).toBe(width * height * 4)
  })
})
