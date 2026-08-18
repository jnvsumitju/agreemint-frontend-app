import { describe, expect, it } from 'vitest'
import { templateStatus, templateVersionNote } from './templateStatus'

/**
 * Two independent things, shown together.
 *
 * <p>The lifecycle status decides whether a template can produce a document at
 * all, and is set by an author. The version note is derived and says whether
 * the committed output has fallen behind the editor. Conflating them is what
 * the original hardcoded "Draft" badge did — it looked like the first and was
 * neither.
 */
describe('template lifecycle badge', () => {
  it('draft says generation is refused, not merely that it is unfinished', () => {
    const s = templateStatus({ status: 'DRAFT', versionNumber: 1, hasUncommittedChanges: false })
    expect(s.label).toBe('Draft')
    expect(s.title).toMatch(/refused/i)
  })

  it('active reads as usable', () => {
    const s = templateStatus({ status: 'ACTIVE', versionNumber: 2, hasUncommittedChanges: false })
    expect(s.label).toBe('Active')
    expect(s.tone).toBe('success')
  })

  it('archived says nothing was deleted, because that is the fear', () => {
    const s = templateStatus({ status: 'ARCHIVED', versionNumber: 9, hasUncommittedChanges: true })
    expect(s.label).toBe('Archived')
    expect(s.title).toMatch(/nothing has been deleted/i)
  })

  it('lifecycle wins over version state — a draft with versions is still a draft', () => {
    // Every template has a committed v1 from creation, so version count can
    // never stand in for readiness.
    expect(
      templateStatus({ status: 'DRAFT', versionNumber: 4, hasUncommittedChanges: false }).label
    ).toBe('Draft')
  })
})

describe('version note', () => {
  it('flags an active template whose edits are not in its committed version', () => {
    const n = templateVersionNote({ versionNumber: 2, hasUncommittedChanges: true })
    expect(n?.label).toBe('v2 · edited')
    expect(n?.title).toMatch(/until you commit/i)
  })

  it('shows the plain version when everything is committed', () => {
    expect(templateVersionNote({ versionNumber: 2, hasUncommittedChanges: false })?.label).toBe('v2')
  })

  it('is absent when there is no version to describe', () => {
    expect(templateVersionNote({ versionNumber: null, hasUncommittedChanges: false })).toBeNull()
  })

  it('carries the real version number', () => {
    expect(templateVersionNote({ versionNumber: 17, hasUncommittedChanges: false })?.label).toBe('v17')
  })
})
