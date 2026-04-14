/**
 * Gradient utility helpers for the template editor.
 *
 * Converts `GradientDef` objects to CSS gradient strings, SVG `<defs>` props,
 * and provides a curated set of preset gradients.
 */

import type { GradientDef, GradientStop } from '../types/layout'

// ── CSS output ────────────────────────────────────────────────────────────────

/** Convert a GradientDef to a CSS gradient value (e.g. `linear-gradient(90deg, #f00 0%, #00f 100%)`). */
export function gradientToCss(g: GradientDef): string {
  const stops = g.stops
    .map((s) => `${s.color} ${Math.round(s.position * 100)}%`)
    .join(', ')
  if (g.type === 'radial') {
    return `radial-gradient(circle, ${stops})`
  }
  return `linear-gradient(${g.angle ?? 0}deg, ${stops})`
}

// ── SVG output ────────────────────────────────────────────────────────────────

/** Generate a stable SVG gradient ID from element id + field (fill/stroke). */
export function svgGradientId(elementId: string, field: 'fill' | 'stroke'): string {
  return `grad-${field}-${elementId}`
}

/**
 * Build props for an SVG `<linearGradient>` element from a GradientDef.
 * For radial gradients the caller should use `<radialGradient>` instead.
 */
export function svgLinearGradientProps(g: GradientDef): {
  x1: string; y1: string; x2: string; y2: string
} {
  const rad = ((g.angle ?? 0) * Math.PI) / 180
  // SVG gradient vector (angle 0 = top→bottom, 90 = left→right)
  const x1 = `${50 - Math.sin(rad) * 50}%`
  const y1 = `${50 + Math.cos(rad) * 50}%`
  const x2 = `${50 + Math.sin(rad) * 50}%`
  const y2 = `${50 - Math.cos(rad) * 50}%`
  return { x1, y1, x2, y2 }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Check whether a gradient is usable (has at least 2 stops). */
export function isValidGradient(g: GradientDef | undefined): g is GradientDef {
  return g != null && Array.isArray(g.stops) && g.stops.length >= 2
}

/** Convenience: creates a simple 2-stop linear gradient. */
export function makeLinearGradient(
  from: string,
  to: string,
  angle = 135,
): GradientDef {
  return {
    type: 'linear',
    angle,
    stops: [
      { color: from, position: 0 },
      { color: to, position: 1 },
    ],
  }
}

/** Deep clone a gradient definition. */
export function cloneGradient(g: GradientDef): GradientDef {
  return {
    type: g.type,
    angle: g.angle,
    stops: g.stops.map((s) => ({ ...s })),
  }
}

/** Ensure stops are sorted by position. */
export function sortStops(stops: GradientStop[]): GradientStop[] {
  return [...stops].sort((a, b) => a.position - b.position)
}

// ── Preset gradients ──────────────────────────────────────────────────────────

export interface GradientPreset {
  label: string
  gradient: GradientDef
}

export const GRADIENT_PRESETS: readonly GradientPreset[] = [
  { label: 'Sunset',    gradient: makeLinearGradient('#f97316', '#ec4899', 135) },
  { label: 'Ocean',     gradient: makeLinearGradient('#06b6d4', '#3b82f6', 135) },
  { label: 'Forest',    gradient: makeLinearGradient('#22c55e', '#14b8a6', 135) },
  { label: 'Lavender',  gradient: makeLinearGradient('#a78bfa', '#ec4899', 135) },
  { label: 'Midnight',  gradient: makeLinearGradient('#1e3a5f', '#4f46e5', 135) },
  { label: 'Peach',     gradient: makeLinearGradient('#fb923c', '#fbbf24', 135) },
  { label: 'Rose',      gradient: makeLinearGradient('#f43f5e', '#a855f7', 135) },
  { label: 'Sky',       gradient: makeLinearGradient('#38bdf8', '#818cf8', 135) },
  { label: 'Ember',     gradient: makeLinearGradient('#ef4444', '#f97316', 90) },
  { label: 'Mint',      gradient: makeLinearGradient('#34d399', '#22d3ee', 135) },
  { label: 'Slate',     gradient: makeLinearGradient('#64748b', '#334155', 180) },
  { label: 'Gold',      gradient: makeLinearGradient('#eab308', '#f59e0b', 135) },
]
