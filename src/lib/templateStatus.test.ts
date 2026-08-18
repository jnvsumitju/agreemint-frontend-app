import { describe, expect, it } from 'vitest'
import { templateStatus } from './templateStatus'

/**
 * The badge has to be able to be wrong before it can be right.
 *
 * <p>What it replaced was the literal string "Draft", hardcoded at both call
 * sites, on every template forever. It could not be tested because it carried
 * no information — and it was misleading in the one case that matters, a
 * long-committed template that generates documents perfectly well.
 */
describe('template status', () => {
  it('never committed reads as Draft', () => {
    const s = templateStatus({ versionNumber: null, hasUncommittedChanges: false })
    expect(s.label).toBe('Draft')
    // Documents generate from a committed version, so this is the state that
    // actually blocks something — the copy has to say so.
    expect(s.title).toMatch(/before generating/i)
  })

  it('a template with no version is Draft even with a draft in progress', () => {
    expect(templateStatus({ versionNumber: null, hasUncommittedChanges: true }).label).toBe('Draft')
  })

  it('committed and untouched shows the version alone', () => {
    const s = templateStatus({ versionNumber: 2, hasUncommittedChanges: false })
    expect(s.label).toBe('v2')
    expect(s.tone).toBe('success')
  })

  it('committed with newer edits says so — the state the old badge hid', () => {
    const s = templateStatus({ versionNumber: 2, hasUncommittedChanges: true })
    expect(s.label).toBe('v2 · edited')
    // The point of this state: what you see in the editor is NOT what documents
    // are being generated from.
    expect(s.title).toContain('v2')
    expect(s.title).toMatch(/until you commit/i)
  })

  it('distinguishes all three states rather than collapsing any two', () => {
    const labels = new Set([
      templateStatus({ versionNumber: null, hasUncommittedChanges: false }).label,
      templateStatus({ versionNumber: 5, hasUncommittedChanges: false }).label,
      templateStatus({ versionNumber: 5, hasUncommittedChanges: true }).label,
    ])
    expect(labels.size).toBe(3)
  })

  it('carries the real version number, not a hardcoded one', () => {
    expect(templateStatus({ versionNumber: 17, hasUncommittedChanges: false }).label).toBe('v17')
  })
})
