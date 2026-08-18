import { describe, expect, it } from 'vitest'
import { templateStatusConfirm } from './templateStatus'

/**
 * The dialog has to say what the change does, not ask "are you sure?".
 *
 * <p>Status is the only thing controlling whether documents can be generated,
 * and two of the three transitions break something already working — including
 * for an API integration holding the template's id, which nobody standing in
 * the console can see. That consequence is the entire reason to confirm, so it
 * has to be in the copy rather than implied by a red button.
 */
describe('status change confirmation', () => {
  it('activating explains that generation becomes possible, including via the API', () => {
    const c = templateStatusConfirm('GST Invoice', 'DRAFT', 'ACTIVE')
    expect(c.confirmLabel).toBe('Activate')
    expect(c.description).toMatch(/API/i)
    // Additive: nothing that currently works stops working.
    expect(c.danger).toBe(false)
  })

  it('archiving promises nothing is deleted, because that is the fear', () => {
    const c = templateStatusConfirm('GST Invoice', 'ACTIVE', 'ARCHIVED')
    expect(c.description).toMatch(/nothing is deleted/i)
    expect(c.description).toMatch(/restore/i)
    expect(c.danger).toBe(true)
  })

  it('deactivating warns that API callers start being refused', () => {
    // The one someone would do casually without realising it is breaking.
    const c = templateStatusConfirm('GST Invoice', 'ACTIVE', 'DRAFT')
    expect(c.description).toMatch(/refused/i)
    expect(c.danger).toBe(true)
  })

  it('restoring from archived is not treated as destructive', () => {
    const c = templateStatusConfirm('GST Invoice', 'ARCHIVED', 'DRAFT')
    expect(c.confirmLabel).toBe('Restore')
    expect(c.danger).toBe(false)
    // And it must not imply the template becomes usable immediately.
    expect(c.description).toMatch(/until you activate/i)
  })

  it('names the template, so the wrong card cannot be confirmed blind', () => {
    for (const to of ['ACTIVE', 'ARCHIVED', 'DRAFT'] as const) {
      expect(templateStatusConfirm('Quarterly Report', 'ACTIVE', to).description)
        .toContain('Quarterly Report')
    }
  })
})
