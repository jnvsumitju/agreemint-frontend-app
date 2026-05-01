/**
 * Pixel-parity feature flag + font defaults for the editor.
 *
 * Default flipped to ON in phase 5. Set `VITE_FEATURE_PIXEL_PARITY=false` to
 * fall back to the legacy CSS-flow preview + Google-Fonts loader without a
 * redeploy — kept as a kill-switch for 6 months post-launch per the risk
 * register. Once the window expires, this function + every `parityOn()` /
 * flag-aware branch can be deleted and the parity path becomes
 * unconditional.
 *
 * The backend flag (`agreemint.features.pixel-parity.enabled`) is the real
 * source of truth for the PDF; the frontend flag only gates what the canvas
 * previews. If they disagree, the PDF still renders via whichever path the
 * backend chose.
 */
export function pixelParityEnabled(): boolean {
  const raw = import.meta.env.VITE_FEATURE_PIXEL_PARITY
  if (typeof raw !== 'string') return true
  const v = raw.toLowerCase()
  return v !== 'false' && v !== '0' && v !== 'no' && v !== 'off'
}

/**
 * The three families we ship embedded TTFs for on the backend. Keep in sync
 * with the backend `PdfFontRegistry.FAMILY_*` constants and the files under
 * `/public/fonts`.
 *
 * New elements default to {@link DEFAULT_FONT_FAMILY}; anything authored with
 * a non-curated family is remapped to the default at load time so the canvas
 * and PDF never diverge on font identity.
 */
export const PARITY_FONT_FAMILIES = {
  sans: 'Inter',
  serif: 'Source Serif 4',
  mono: 'JetBrains Mono',
} as const

export const DEFAULT_FONT_FAMILY = PARITY_FONT_FAMILIES.sans

/**
 * Per-feature flags for Phase 4 UI gating. When parity is ON, these decide
 * whether the editor surfaces the corresponding controls. Matches what the
 * backend renderer actually supports — authors never see a control for a
 * property the PDF will silently ignore.
 *
 * <p>Off the parity flag, all features remain available under the legacy
 * code path (nothing here changes). The gating only applies once parity is
 * enabled, so existing layouts keep behaving as they always did.
 */
export interface ParityFeatureSupport {
  /** Phase 4 (shipped): text/shape/image rotation via CSS transform + PdfCanvas concatMatrix. */
  rotation: boolean
  /** Phase 4 (shipped): borderWidth + lineStyle (solid/dashed/dotted) for BOX/LINE/shapes. */
  lineStyleAndWidth: boolean
  /** Deferred — requires iText gradient graphics state support. */
  gradients: boolean
  /** Deferred — requires rasterized overlay or heavy canvas work. */
  shadow: boolean
  /** Deferred — requires rounded-corner rectangle via 4 Bezier arcs in iText. */
  borderRadius: boolean
  /** Deferred — requires PdfExtGState opacity + careful compositing. */
  opacity: boolean
}

/**
 * The live feature matrix. Toggle individual flags as each backend capability
 * ships so the editor UI re-enables in lockstep.
 */
export function parityFeatureSupport(): ParityFeatureSupport {
  return {
    rotation: true,
    lineStyleAndWidth: true,
    gradients: true,    // Phase 6d (BOX linear). Radial + text-gradient sub-phases land next.
    shadow: true,       // Phase 6c (BOX rasterised shadow; SMask-crisp upgrade noted as sub-phase).
    borderRadius: true, // Phase 6a (BOX). IMAGE clip-to-rounded lands next.
    opacity: true,      // Phase 6b (TEXT / IMAGE / BOX / LINE via PdfExtGState).
  }
}

/**
 * True when the editor should display a control for the named feature.
 * Off the parity flag: always true (legacy behaviour). On the flag: only
 * true when the backend actually supports rendering that feature.
 */
export function isParityFeatureEnabled(feature: keyof ParityFeatureSupport): boolean {
  if (!pixelParityEnabled()) return true
  return parityFeatureSupport()[feature]
}

/** True when the given family is one of the three TTFs we ship. */
export function isParityFontFamily(family: string | undefined | null): boolean {
  if (!family) return false
  const values: readonly string[] = Object.values(PARITY_FONT_FAMILIES)
  return values.includes(family)
}

/**
 * Normalise an author-supplied (or legacy) family to something we can render
 * with parity. When the flag is off this is a pass-through — phases 0-4 must
 * not silently rewrite existing layouts. When the flag is on, a non-parity
 * family is coerced to {@link DEFAULT_FONT_FAMILY} so canvas and PDF agree
 * on the glyph source.
 */
export function coerceToSupportedFamily(family: string | undefined | null): string | undefined {
  if (!pixelParityEnabled()) return family ?? undefined
  if (!family) return DEFAULT_FONT_FAMILY
  if (isParityFontFamily(family)) return family
  return DEFAULT_FONT_FAMILY
}
