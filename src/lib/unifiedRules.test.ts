import { describe, expect, it } from 'vitest'
import {
  evaluateCondition,
  evaluateRuleValue,
  evaluateRules,
  legacyToRules,
} from './unifiedRules'
import { variableValuesToDataTree } from './layoutBehaviourResolve'
import type { ElementBehaviour, Rule } from '../types/layoutBehaviour'

// ─── evaluateCondition ──────────────────────────────────────────────────

describe('evaluateCondition', () => {
  const data = variableValuesToDataTree({
    status: 'paid',
    amount: '150',
    region: 'US',
  })

  it('returns true for undefined / empty trees (always applies)', () => {
    expect(evaluateCondition(undefined, data, null)).toBe(true)
    expect(evaluateCondition({ kind: 'all', of: [] }, data, null)).toBe(true)
    expect(evaluateCondition({ kind: 'any', of: [] }, data, null)).toBe(true)
  })

  it('evaluates single comparison leaves', () => {
    expect(evaluateCondition(
      { kind: 'compare', left: '{{status}}', op: 'eq', right: 'paid' },
      data, null,
    )).toBe(true)
    expect(evaluateCondition(
      { kind: 'compare', left: '{{status}}', op: 'eq', right: 'overdue' },
      data, null,
    )).toBe(false)
  })

  it('AND requires every child to match', () => {
    const cond = {
      kind: 'all' as const,
      of: [
        { kind: 'compare' as const, left: '{{status}}', op: 'eq' as const, right: 'paid' },
        { kind: 'compare' as const, left: '{{amount}}', op: 'gt' as const, right: 100 },
      ],
    }
    expect(evaluateCondition(cond, data, null)).toBe(true)
    const bad = variableValuesToDataTree({ status: 'paid', amount: '10' })
    expect(evaluateCondition(cond, bad, null)).toBe(false)
  })

  it('OR requires at least one child to match', () => {
    const cond = {
      kind: 'any' as const,
      of: [
        { kind: 'compare' as const, left: '{{status}}', op: 'eq' as const, right: 'overdue' },
        { kind: 'compare' as const, left: '{{region}}', op: 'eq' as const, right: 'US' },
      ],
    }
    expect(evaluateCondition(cond, data, null)).toBe(true)
  })

  it('supports nested AND/OR groups', () => {
    //  (status == paid AND amount > 100) OR region == EU
    const cond = {
      kind: 'any' as const,
      of: [
        {
          kind: 'all' as const,
          of: [
            { kind: 'compare' as const, left: '{{status}}', op: 'eq' as const, right: 'paid' },
            { kind: 'compare' as const, left: '{{amount}}', op: 'gt' as const, right: 100 },
          ],
        },
        { kind: 'compare' as const, left: '{{region}}', op: 'eq' as const, right: 'EU' },
      ],
    }
    expect(evaluateCondition(cond, data, null)).toBe(true)
  })
})

// ─── evaluateRuleValue (each mode) ──────────────────────────────────────

describe('evaluateRuleValue', () => {
  const data = variableValuesToDataTree({
    percent: '0.6',
    status: 'overdue',
    brand: '#7c3aed',
  })

  it('fixed mode → passes literal through, coerced to the target kind', () => {
    expect(evaluateRuleValue({ mode: 'fixed', value: '100' }, 'number', data, null)).toBe(100)
    expect(evaluateRuleValue({ mode: 'fixed', value: '#ff00ff' }, 'color', data, null)).toBe('#ff00ff')
    expect(evaluateRuleValue({ mode: 'fixed', value: 'dashed' }, 'lineStyle', data, null)).toBe('dashed')
  })

  it('variable mode → resolves and returns the looked-up value', () => {
    expect(evaluateRuleValue({ mode: 'variable', var: 'percent' }, 'number', data, null)).toBe(0.6)
    expect(evaluateRuleValue({ mode: 'variable', var: 'brand' }, 'color', data, null)).toBe('#7c3aed')
  })

  it('variable mode → returns undefined when the variable is missing or empty', () => {
    expect(evaluateRuleValue({ mode: 'variable', var: 'missing' }, 'number', data, null)).toBeUndefined()
  })

  it('scaled mode → multiplies and clamps', () => {
    expect(evaluateRuleValue(
      { mode: 'scaled', var: 'percent', multiplier: 200 },
      'number', data, null,
    )).toBe(120) // 0.6 × 200

    expect(evaluateRuleValue(
      { mode: 'scaled', var: 'percent', multiplier: 200, min: 20, max: 100 },
      'number', data, null,
    )).toBe(100) // 0.6 × 200 = 120 → clamped to 100
  })

  it('mapping mode → picks the matching case', () => {
    const rv = {
      mode: 'mapping' as const,
      var: 'status',
      cases: [
        { match: 'paid', value: '#10b981' },
        { match: 'overdue', value: '#ef4444' },
      ],
      fallback: '#6b7280',
    }
    expect(evaluateRuleValue(rv, 'color', data, null)).toBe('#ef4444')

    const dataPaid = variableValuesToDataTree({ status: 'paid' })
    expect(evaluateRuleValue(rv, 'color', dataPaid, null)).toBe('#10b981')
  })

  it('mapping mode → falls back when no case matches', () => {
    const rv = {
      mode: 'mapping' as const,
      var: 'status',
      cases: [{ match: 'paid', value: '#10b981' }],
      fallback: '#aaaaaa',
    }
    expect(evaluateRuleValue(rv, 'color', data, null)).toBe('#aaaaaa')
  })

  it('expression mode → numeric targets run evalSizeExpression', () => {
    expect(evaluateRuleValue(
      { mode: 'expression', expression: 'clamp({{percent}}*200, 20, 100)' },
      'number', data, null,
    )).toBe(100)
  })

  it('expression mode → string targets go through substitution', () => {
    expect(evaluateRuleValue(
      { mode: 'expression', expression: 'color-{{status}}' },
      'color', data, null,
    )).toBe('color-overdue')
  })
})

// ─── evaluateRules precedence ──────────────────────────────────────────

describe('evaluateRules', () => {
  const data = variableValuesToDataTree({ status: 'paid', percent: '0.5' })

  it('empty rules → defaultShow controls visibility', () => {
    expect(evaluateRules([], true, data, null).visible).toBe(true)
    expect(evaluateRules([], false, data, null).visible).toBe(false)
  })

  it('hide/show: first matching rule wins; others ignored', () => {
    const rules: Rule[] = [
      {
        id: 'a',
        when: { kind: 'compare', left: '{{status}}', op: 'eq', right: 'paid' },
        action: { kind: 'hide' },
      },
      {
        id: 'b',
        when: { kind: 'compare', left: '{{status}}', op: 'eq', right: 'paid' },
        action: { kind: 'show' }, // would contradict but should be ignored
      },
    ]
    expect(evaluateRules(rules, true, data, null).visible).toBe(false)
  })

  it('disabled rules are skipped entirely', () => {
    const rules: Rule[] = [
      {
        id: 'a',
        enabled: false,
        when: { kind: 'compare', left: '{{status}}', op: 'eq', right: 'paid' },
        action: { kind: 'hide' },
      },
    ]
    expect(evaluateRules(rules, true, data, null).visible).toBe(true)
  })

  it('set rules: last write wins for same target', () => {
    const rules: Rule[] = [
      {
        id: 'a',
        action: { kind: 'set', target: 'fillColor', value: { mode: 'fixed', value: '#000' } },
      },
      {
        id: 'b',
        action: { kind: 'set', target: 'fillColor', value: { mode: 'fixed', value: '#fff' } },
      },
    ]
    const r = evaluateRules(rules, true, data, null)
    const finalFill = r.sets.filter((s) => s.target === 'fillColor').pop()?.value
    expect(finalFill).toBe('#fff')
  })

  it('set with unsatisfied when → rule does not contribute a write', () => {
    const rules: Rule[] = [
      {
        id: 'a',
        when: { kind: 'compare', left: '{{status}}', op: 'eq', right: 'overdue' },
        action: { kind: 'set', target: 'fillColor', value: { mode: 'fixed', value: '#ef4444' } },
      },
    ]
    const r = evaluateRules(rules, true, data, null)
    expect(r.sets.find((s) => s.target === 'fillColor')).toBeUndefined()
  })
})

// ─── legacyToRules derivation ──────────────────────────────────────────

describe('legacyToRules', () => {
  it('returns the existing rules array untouched when one is present', () => {
    const rules: Rule[] = [{ id: 'x', action: { kind: 'hide' } }]
    const b: ElementBehaviour = { rules }
    expect(legacyToRules(b)).toEqual(rules)
  })

  it('emits hide rules from visibilityRules with show:false', () => {
    const b: ElementBehaviour = {
      visibilityRules: [{ when: { left: '{{x}}', op: 'eq', right: '1' }, show: false }],
    }
    const out = legacyToRules(b)
    expect(out).toHaveLength(1)
    expect(out[0].action).toEqual({ kind: 'hide' })
    expect(out[0].when).toMatchObject({ kind: 'compare', left: '{{x}}', op: 'eq', right: '1' })
  })

  it('emits separate rules for stroke + fill in a single colorRule', () => {
    const b: ElementBehaviour = {
      colorRules: [{
        when: { left: '{{status}}', op: 'eq', right: 'paid' },
        strokeColor: '#10b981',
        fillColor: '#ecfdf5',
      }],
    }
    const out = legacyToRules(b)
    expect(out).toHaveLength(2)
    expect(out[0].action).toMatchObject({ kind: 'set', target: 'strokeColor' })
    expect(out[1].action).toMatchObject({ kind: 'set', target: 'fillColor' })
  })

  it('parses the "clamp({{var}}*N, min, max)" shape into a scaled value', () => {
    const b: ElementBehaviour = {
      size: { widthExpr: 'clamp({{barPct}}*200, 20, 200)' },
    }
    const out = legacyToRules(b)
    expect(out).toHaveLength(1)
    expect(out[0].action).toMatchObject({
      kind: 'set',
      target: 'width',
      value: { mode: 'scaled', var: 'barPct', multiplier: 200, min: 20, max: 200 },
    })
  })

  it('parses "{{var}}*N" into scaled without bounds (plus legacy min/max propagates)', () => {
    const b: ElementBehaviour = {
      size: { widthExpr: '{{percent}}*300', minWidth: 50, maxWidth: 600 },
    }
    const out = legacyToRules(b)
    expect(out[0].action).toMatchObject({
      kind: 'set',
      target: 'width',
      value: { mode: 'scaled', var: 'percent', multiplier: 300, min: 50, max: 600 },
    })
  })

  it('passes an unrecognised expression through as mode:expression', () => {
    const b: ElementBehaviour = {
      size: { widthExpr: 'max({{a}}, {{b}}) + 10' },
    }
    const out = legacyToRules(b)
    expect(out[0].action).toMatchObject({
      kind: 'set',
      target: 'width',
      value: { mode: 'expression', expression: 'max({{a}}, {{b}}) + 10' },
    })
  })

  it('emits a dedicated rule for imageSrcExpr', () => {
    const b: ElementBehaviour = { imageSrcExpr: '{{imageUrl}}' }
    const out = legacyToRules(b)
    expect(out).toHaveLength(1)
    expect(out[0].action).toMatchObject({ kind: 'set', target: 'imageSrc' })
  })

  it('preserves the legacy pipeline order (visibility → colors → size → image)', () => {
    const b: ElementBehaviour = {
      visibilityRules: [{ when: { left: '{{x}}', op: 'eq', right: '1' }, show: false }],
      colorRules: [{ when: { left: '{{y}}', op: 'eq', right: '2' }, fillColor: '#fff' }],
      size: { widthExpr: '{{z}}*10' },
      imageSrcExpr: '{{img}}',
    }
    const out = legacyToRules(b)
    expect(out.map((r) => r.action.kind)).toEqual(['hide', 'set', 'set', 'set'])
    const targets = out
      .filter((r) => r.action.kind === 'set')
      .map((r) => (r.action as { target: string }).target)
    expect(targets).toEqual(['fillColor', 'width', 'imageSrc'])
  })
})
