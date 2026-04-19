/**
 * Unified rules — adapter from the legacy element behaviour schema to the
 * new `Rule[]` format, plus a resolver that evaluates that unified list.
 *
 * This module does NOT touch rendering. It provides two pure functions the
 * rest of the app composes with:
 *
 *   1. {@link legacyToRules} — one-way, lossless derivation of a `Rule[]`
 *      array from an `ElementBehaviour` that still uses
 *      `visibilityRules` / `colorRules` / `size` / `imageSrcExpr` fields.
 *      Used both by the new editor to seed its state from old templates,
 *      and (eventually) by the resolver as a compat shim.
 *
 *   2. {@link evaluateRules} — given a unified rules list, current data,
 *      and row context (for table-row scope), return the final visibility
 *      flag and the set of `(target, value)` writes to apply to the
 *      element. Nothing in this file mutates the element — the caller
 *      decides how to apply the writes.
 *
 * Both functions delegate the fiddly bits (variable substitution, number
 * coercion, condition evaluation) to {@link layoutBehaviourResolve} so
 * there's exactly one substitution engine shared between the legacy and
 * unified paths.
 */
import type {
  BindingTarget,
  Condition,
  ElementBehaviour,
  MappingCase,
  Rule,
  RuleValue,
} from '../types/layoutBehaviour'
import type { ElementShadow, ElementStyle, LayoutElement } from '../types/layout'
import {
  clamp,
  coerceNumber,
  evalCondition,
  evalSizeExpression,
  lookup,
  substituteTemplate,
} from './layoutBehaviourResolve'
import { BINDING_TARGETS } from './bindingTargets'

// ── Condition tree evaluation ──────────────────────────────────────────────

/**
 * Evaluate a condition tree. Empty trees return `true` (matches the legacy
 * "no when = always applies" semantics). Leaves use the existing single-
 * comparison {@link evalCondition} so operator semantics are identical.
 */
export function evaluateCondition(
  c: Condition | undefined,
  data: Record<string, unknown>,
  row: Record<string, unknown> | null,
): boolean {
  if (!c) return true
  if (c.kind === 'all') {
    if (!c.of.length) return true
    return c.of.every((child) => evaluateCondition(child, data, row))
  }
  if (c.kind === 'any') {
    if (!c.of.length) return true
    return c.of.some((child) => evaluateCondition(child, data, row))
  }
  // Leaf comparison — adapt to the legacy shape and delegate.
  return evalCondition({ left: c.left, op: c.op, right: c.right }, data, row)
}

// ── Value resolution (per RuleValue mode) ──────────────────────────────────

/**
 * Resolve a {@link RuleValue} to a concrete number or string with the given
 * data context. Returns `undefined` if the value can't be meaningfully
 * coerced (missing variable, bad expression, etc.) — callers treat
 * `undefined` as "fall back to static / previous value".
 *
 * The {@code valueKind} hint is the registered input kind for the target
 * (from {@link BINDING_TARGETS}); it drives coercion so a number target
 * doesn't get a raw string and a color target doesn't get a number.
 */
export function evaluateRuleValue(
  rv: RuleValue,
  valueKind: 'number' | 'color' | 'lineStyle' | 'textAlign' | 'fontFamily' | 'imageUrl',
  data: Record<string, unknown>,
  row: Record<string, unknown> | null,
): string | number | undefined {
  switch (rv.mode) {
    case 'fixed':
      return coerceToKind(rv.value, valueKind)

    case 'variable': {
      const raw = lookup(rv.var, data, row)
      if (raw === undefined || raw === null || raw === '') return undefined
      return coerceToKind(raw as string | number, valueKind)
    }

    case 'scaled': {
      const raw = lookup(rv.var, data, row)
      const n = coerceNumber(raw)
      if (n == null) return undefined
      const scaled = n * rv.multiplier
      const lo = rv.min ?? -Infinity
      const hi = rv.max ?? Infinity
      return clamp(scaled, lo, hi)
    }

    case 'mapping': {
      const raw = lookup(rv.var, data, row)
      const hit = matchMapping(raw, rv.cases)
      const v = hit ?? rv.fallback
      if (v === undefined) return undefined
      return coerceToKind(v, valueKind)
    }

    case 'expression': {
      // Numeric target → reuse the size-expression evaluator (clamp/min/max/
      // arithmetic). String target → plain `{{}}` substitution.
      if (valueKind === 'number') {
        const sub = substituteTemplate(rv.expression, data, row)
        const result = evalSizeExpression(sub, NaN)
        return Number.isFinite(result) ? result : undefined
      }
      const result = substituteTemplate(rv.expression, data, row)
      return result || undefined
    }
  }
}

/**
 * Match a variable value against a list of case rows. Cases compare with
 * loose equality after stringification so `1` and `"1"` are the same case.
 */
function matchMapping(raw: unknown, cases: MappingCase[]): string | number | undefined {
  const needle = String(raw ?? '')
  for (const c of cases) {
    if (String(c.match) === needle) return c.value
  }
  return undefined
}

/**
 * Coerce a raw scalar into the target's expected value kind. Returns
 * `undefined` on unrecoverable type mismatch (e.g. `"red"` for a number
 * target) so the caller can fall back to the static value.
 */
function coerceToKind(
  v: string | number,
  kind: 'number' | 'color' | 'lineStyle' | 'textAlign' | 'fontFamily' | 'imageUrl',
): string | number | undefined {
  if (kind === 'number') {
    const n = coerceNumber(v)
    return n == null ? undefined : n
  }
  // Enum-typed: trust the string. An invalid enum will still render, just
  // as the legacy code did — better than silently dropping the binding.
  return typeof v === 'number' ? String(v) : v
}

// ── Rules evaluation ──────────────────────────────────────────────────────

export interface RulesEvaluation {
  /** Final visibility after processing hide/show rules + {@code defaultShow}. */
  visible: boolean
  /**
   * Writes to apply, in order. Later entries overwrite earlier ones with
   * the same target — "last write wins", matching the legacy size + color
   * combination semantics.
   */
  sets: Array<{ target: BindingTarget; value: string | number }>
}

/**
 * Evaluate a unified rules list.
 *
 * Precedence (documented in PLAN.md, enforced here):
 *   1. Visibility (`hide` / `show` actions) — first matching rule wins;
 *      otherwise {@code defaultShow}.
 *   2. Property writes (`set` actions) — every matching rule contributes;
 *      later entries override earlier ones for the same target.
 */
export function evaluateRules(
  rules: readonly Rule[] | undefined,
  defaultShow: boolean,
  data: Record<string, unknown>,
  row: Record<string, unknown> | null,
): RulesEvaluation {
  const sets: RulesEvaluation['sets'] = []
  let visibilityDecided: boolean | undefined = undefined

  if (!rules || rules.length === 0) {
    return { visible: defaultShow, sets }
  }

  for (const rule of rules) {
    if (rule.enabled === false) continue
    if (!evaluateCondition(rule.when, data, row)) continue
    const a = rule.action
    if (a.kind === 'hide') {
      if (visibilityDecided === undefined) visibilityDecided = false
      continue
    }
    if (a.kind === 'show') {
      if (visibilityDecided === undefined) visibilityDecided = true
      continue
    }
    if (a.kind === 'set') {
      const spec = BINDING_TARGETS[a.target]
      const value = evaluateRuleValue(a.value, spec.valueKind, data, row)
      if (value !== undefined) sets.push({ target: a.target, value })
    }
  }

  return {
    visible: visibilityDecided ?? defaultShow,
    sets,
  }
}

// ── Apply rule writes onto an element ─────────────────────────────────────

/** Returned shadow object, merged with sensible defaults so a partial set
 *  like `shadowX: 4` produces a valid shadow even from a blank state. */
const DEFAULT_SHADOW: ElementShadow = {
  offsetX: 0,
  offsetY: 0,
  blur: 0,
  color: '#00000040',
}

/**
 * Apply the result of {@link evaluateRules} onto an element. Used by the
 * main resolver ({@code resolveLayoutElement}) and by preview pathways.
 * Each call returns a new `LayoutElement`; the input is not mutated.
 */
export function applyRuleSets(
  el: LayoutElement,
  sets: ReadonlyArray<{ target: BindingTarget; value: string | number }>,
): LayoutElement {
  let next = el
  for (const s of sets) {
    next = applyRuleSet(next, s.target, s.value)
  }
  return next
}

/** Write a single `(target, value)` onto an element. Exported so the
 *  binding-indicator UI can preview the write in isolation. */
export function applyRuleSet(
  el: LayoutElement,
  target: BindingTarget,
  value: string | number,
): LayoutElement {
  // Top-level layout props (numbers only).
  if (target === 'x') return { ...el, x: Number(value) }
  if (target === 'y') return { ...el, y: Number(value) }
  if (target === 'width') return { ...el, width: Number(value) }
  if (target === 'height') return { ...el, height: Number(value) }
  if (target === 'strokeWidth') return { ...el, strokeWidth: Number(value) }

  // Image src is a top-level field, not a style.
  if (target === 'imageSrc') return { ...el, src: String(value) }

  // Everything else flows into the style object. `style` is immutable per
  // write so React re-renders see a fresh reference.
  const prevStyle: ElementStyle = el.style ? { ...el.style } : {}
  const nextStyle = writeStyleTarget(prevStyle, target, value)
  return { ...el, style: nextStyle }
}

/** Write a style-level binding. Shadow targets merge into `style.shadow`. */
function writeStyleTarget(
  style: ElementStyle,
  target: BindingTarget,
  value: string | number,
): ElementStyle {
  switch (target) {
    case 'strokeColor':
    case 'textColor':
      return { ...style, color: String(value) }
    case 'fillColor':
      return { ...style, backgroundColor: String(value) }
    case 'lineStyle': {
      const v = String(value) as ElementStyle['lineStyle']
      return { ...style, lineStyle: v }
    }
    case 'opacity': {
      // The registry declares unit = '%', so users author 75 meaning 75%.
      // Storage is the 0..1 form expected by ElementStyle.
      const pct = Number(value)
      if (!Number.isFinite(pct)) return style
      return { ...style, opacity: clamp(pct / 100, 0, 1) }
    }
    case 'rotation':
      return { ...style, rotation: Number(value) }
    case 'borderRadius':
      return { ...style, borderRadius: Number(value) }
    case 'borderWidth':
      return { ...style, borderWidth: Number(value) }
    case 'fontSize':
      return { ...style, fontSize: Number(value) }
    case 'fontFamily':
      return { ...style, fontFamily: String(value) }
    case 'lineHeight':
      return { ...style, lineHeight: Number(value) }
    case 'textAlign': {
      // ElementStyle's field is called `align` and only supports the three
      // core values — drop anything else on the floor.
      const raw = String(value)
      if (raw !== 'left' && raw !== 'center' && raw !== 'right') return style
      return { ...style, align: raw }
    }
    // ── Shadow — four targets, one object. Seed defaults so a partial
    // set produces a visually consistent shadow. ─────────────────────
    case 'shadowX': {
      const shadow = { ...(style.shadow ?? DEFAULT_SHADOW), offsetX: Number(value) }
      return { ...style, shadow }
    }
    case 'shadowY': {
      const shadow = { ...(style.shadow ?? DEFAULT_SHADOW), offsetY: Number(value) }
      return { ...style, shadow }
    }
    case 'shadowBlur': {
      const shadow = { ...(style.shadow ?? DEFAULT_SHADOW), blur: Number(value) }
      return { ...style, shadow }
    }
    case 'shadowColor': {
      const shadow = { ...(style.shadow ?? DEFAULT_SHADOW), color: String(value) }
      return { ...style, shadow }
    }
    // Layout / non-style targets fall through — handled by caller.
    default:
      return style
  }
}

// ── Legacy adapter ─────────────────────────────────────────────────────────

/**
 * Derive a unified `Rule[]` from an {@link ElementBehaviour} that still
 * uses the split legacy fields. Lossless in both directions: the produced
 * rules evaluate to the exact same element state as the legacy
 * `resolveVisibility` + `resolveColors` + `resolveSize` pipeline.
 *
 * Order of the output follows the legacy pipeline order so precedence
 * matches one-for-one:
 *
 *   1. Visibility rules (preserving first-match-wins via rule order)
 *   2. Color rules — stroke + fill emitted separately per legacy entry
 *   3. Size expressions (width / height)
 *   4. Image URL expression
 */
export function legacyToRules(b: ElementBehaviour | undefined): Rule[] {
  if (!b) return []
  // If the caller already stored `rules`, trust that — no round-trip.
  if (b.rules && b.rules.length > 0) return b.rules.slice()

  const out: Rule[] = []
  let idCounter = 0
  const nextId = () => `lg-${idCounter++}`

  for (const v of b.visibilityRules ?? []) {
    out.push({
      id: nextId(),
      when: toCondition(v.when),
      action: v.show ? { kind: 'show' } : { kind: 'hide' },
    })
  }
  for (const c of b.colorRules ?? []) {
    if (c.strokeColor) {
      out.push({
        id: nextId(),
        when: toCondition(c.when),
        action: {
          kind: 'set',
          target: 'strokeColor',
          value: { mode: 'fixed', value: c.strokeColor },
        },
      })
    }
    if (c.fillColor) {
      out.push({
        id: nextId(),
        when: toCondition(c.when),
        action: {
          kind: 'set',
          target: 'fillColor',
          value: { mode: 'fixed', value: c.fillColor },
        },
      })
    }
  }
  if (b.size?.widthExpr) {
    out.push({
      id: nextId(),
      action: {
        kind: 'set',
        target: 'width',
        value: parseLegacyExpr(b.size.widthExpr, b.size.minWidth, b.size.maxWidth),
      },
    })
  }
  if (b.size?.heightExpr) {
    out.push({
      id: nextId(),
      action: {
        kind: 'set',
        target: 'height',
        value: parseLegacyExpr(b.size.heightExpr, b.size.minHeight, b.size.maxHeight),
      },
    })
  }
  if (b.imageSrcExpr) {
    out.push({
      id: nextId(),
      action: {
        kind: 'set',
        target: 'imageSrc',
        value: { mode: 'expression', expression: b.imageSrcExpr },
      },
    })
  }
  return out
}

/** Convert a legacy flat condition to the new tree form (a single leaf). */
function toCondition(
  c: NonNullable<ElementBehaviour['visibilityRules']>[number]['when'],
): Condition {
  return { kind: 'compare', left: String(c.left), op: c.op, right: c.right }
}

/**
 * Best-effort parse of a legacy `widthExpr` / `heightExpr` into the new
 * typed {@link RuleValue} modes. Falls through to `expression` if the
 * expression doesn't match any of our recognised patterns so we never
 * lose semantics.
 *
 * Recognised patterns:
 *   `{{var}}`                    → variable pass-through
 *   `{{var}} * N`                → scaled (no clamp)
 *   `clamp({{var}}*N, MIN, MAX)` → scaled (with clamp)
 */
function parseLegacyExpr(expr: string, legacyMin?: number, legacyMax?: number): RuleValue {
  const trimmed = expr.trim()

  // `clamp({{var}}*N, min, max)` — most common shape.
  const clampMatch = /^clamp\(\s*\{\{([\w.]+)\}\}\s*\*\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*\)$/.exec(trimmed)
  if (clampMatch) {
    return {
      mode: 'scaled',
      var: clampMatch[1],
      multiplier: Number(clampMatch[2]),
      min: legacyMin ?? Number(clampMatch[3]),
      max: legacyMax ?? Number(clampMatch[4]),
    }
  }

  // `{{var}} * N` — scaled without clamp.
  const scaledMatch = /^\{\{([\w.]+)\}\}\s*\*\s*([-+]?\d+(?:\.\d+)?)$/.exec(trimmed)
  if (scaledMatch) {
    return {
      mode: 'scaled',
      var: scaledMatch[1],
      multiplier: Number(scaledMatch[2]),
      min: legacyMin,
      max: legacyMax,
    }
  }

  // `{{var}}` — plain pass-through.
  const varMatch = /^\{\{([\w.]+)\}\}$/.exec(trimmed)
  if (varMatch) {
    return { mode: 'variable', var: varMatch[1] }
  }

  // Fall-through: keep the full expression intact.
  return { mode: 'expression', expression: trimmed }
}
