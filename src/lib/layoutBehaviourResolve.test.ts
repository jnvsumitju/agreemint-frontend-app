import { describe, expect, it } from 'vitest'
import {
  availableVariableMentionsForMentionSuggest,
  pageLocalShadowStorageKey,
  resolveLayoutElement,
  resolveVariableChipInfo,
  variableMergeFieldSurfaceLabel,
  variableValuesToDataTree,
} from './layoutBehaviourResolve'
import type { LayoutElement } from '../types/layout'

describe('resolveLayoutElement', () => {
  it('hides when visibility rule matches show false', () => {
    const el: LayoutElement = {
      id: '1',
      type: 'BOX',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      behaviour: {
        visibilityRules: [{ when: { left: '{{x}}', op: 'eq', right: '1' }, show: false }],
      },
    }
    const data = variableValuesToDataTree({ x: '1' })
    const r = resolveLayoutElement(el, data, null)
    expect(r.visible).toBe(false)
  })

  it('applies width from size expression', () => {
    const el: LayoutElement = {
      id: '1',
      type: 'BOX',
      x: 0,
      y: 0,
      width: 50,
      height: 10,
      behaviour: {
        size: { widthExpr: '{{w}}', minWidth: 1, maxWidth: 999 },
      },
    }
    const data = variableValuesToDataTree({ w: '88' })
    const r = resolveLayoutElement(el, data, null)
    expect(r.visible).toBe(true)
    expect(r.element.width).toBe(88)
  })
})

describe('availableVariableMentionsForMentionSuggest', () => {
  it('includes global catalog, page locals, keys from variableValues, and usage on other pages', () => {
    const pages = [
      {
        id: 'p1',
        name: 'Page 1',
        elements: [
          {
            id: 't1',
            type: 'TEXT' as const,
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            content: '{"rich":true,"runs":[{"type":"var","name":"only_on_p2"}]}',
          },
        ],
        localVariables: [{ key: 'page_local' }],
      },
      {
        id: 'p2',
        name: 'Page 2',
        elements: [
          {
            id: 't2',
            type: 'TEXT' as const,
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            content: '{"rich":true,"runs":[{"type":"text","text":"x"}]}',
          },
        ],
      },
    ]
    const items = availableVariableMentionsForMentionSuggest(
      [{ key: 'global_catalog' }],
      pages,
      0,
      { preview_only: '1', items: '[]' }
    )
    const ids = items.map((m) => m.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'global_catalog',
        'page_local',
        'only_on_p2',
        'preview_only',
        'items',
      ])
    )
  })

  it('emits two @ rows when global and active page local share a key', () => {
    const pages = [
      {
        id: 'p1',
        name: 'Page 1',
        elements: [],
        localVariables: [{ key: 'customer_name' }],
      },
    ]
    const items = availableVariableMentionsForMentionSuggest(
      [{ key: 'customer_name' }],
      pages,
      0,
      {}
    )
    const byId = Object.fromEntries(items.map((m) => [m.id, m.label]))
    expect(byId.customer_name).toContain('template-wide')
    expect(byId[pageLocalShadowStorageKey('customer_name')]).toContain('this page')
  })
})

describe('resolveVariableChipInfo', () => {
  it('marks template-wide when only global catalog matches', () => {
    const info = resolveVariableChipInfo('order_id', [{ key: 'order_id', description: 'SO number' }], undefined, {
      order_id: 'SO-99',
    })
    expect(info.token).toBe('{{order_id}}')
    expect(info.scopeLine).toContain('Template-wide')
    expect(info.description).toContain('SO number')
    expect(info.previewLine).toContain('SO-99')
  })

  it('describes _page shadow token for page-local preview', () => {
    const page = { id: 'p1', name: 'P1', elements: [], localVariables: [{ key: 'x' }] }
    const info = resolveVariableChipInfo(
      pageLocalShadowStorageKey('x'),
      [{ key: 'x' }],
      page,
      { [pageLocalShadowStorageKey('x')]: 'local val' }
    )
    expect(info.token).toBe(`{{${pageLocalShadowStorageKey('x')}}}`)
    expect(info.scopeLine).toContain('This page only')
    expect(info.previewLine).toContain('local val')
  })
})

describe('variableMergeFieldSurfaceLabel', () => {
  it('uses Global for template-wide catalog only', () => {
    expect(variableMergeFieldSurfaceLabel('order_id', [{ key: 'order_id' }], undefined)).toBe(
      'Global.Order Id'
    )
  })

  it('uses Page for page-local catalog only', () => {
    const page = { id: 'p1', name: 'P1', elements: [], localVariables: [{ key: 'customer_name' }] }
    expect(variableMergeFieldSurfaceLabel('customer_name', [], page)).toBe('Page.Customer Name')
  })

  it('uses Page for _page shadow token', () => {
    const page = { id: 'p1', name: 'P1', elements: [], localVariables: [{ key: 'x' }] }
    expect(variableMergeFieldSurfaceLabel(pageLocalShadowStorageKey('x'), [{ key: 'x' }], page)).toBe(
      'Page.X'
    )
  })

  it('uses Global when both catalogs declare the same key (plain token)', () => {
    const page = { id: 'p1', name: 'P1', elements: [], localVariables: [{ key: 'customer_name' }] }
    expect(
      variableMergeFieldSurfaceLabel('customer_name', [{ key: 'customer_name' }], page)
    ).toBe('Global.Customer Name')
  })

  it('falls back to token when not in catalog', () => {
    expect(variableMergeFieldSurfaceLabel('ad_hoc', [], undefined)).toBe('{{ad_hoc}}')
  })
})
