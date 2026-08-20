import { describe, expect, it } from 'vitest'
import { diffVariableValues } from './variablePatch'

/**
 * What one editor asserts when it saves.
 *
 * <p>The whole-map PUT this replaces was last-writer-wins over every key: two
 * people editing different variables inside the same 800ms debounce meant the
 * second save silently erased the first one's work. A diff fixes it only if it
 * is honest in both directions — claiming too much re-clobbers, claiming too
 * little loses the edit.
 */
describe('variable patch diff', () => {
  it('sends only what changed', () => {
    const patch = diffVariableValues(
      { 'company.name': 'Acme', 'invoice.total': '100' },
      { 'company.name': 'Acme Ltd', 'invoice.total': '100' }
    )
    expect(patch.set).toEqual({ 'company.name': 'Acme Ltd' })
    expect(patch.remove).toEqual([])
  })

  it('does not resend untouched keys', () => {
    // The whole point: an unrelated key must not appear, or this client
    // re-asserts a stale value over a collaborator's newer one.
    const patch = diffVariableValues(
      { a: '1', b: '2', c: '3' },
      { a: '1', b: 'changed', c: '3' }
    )
    expect(Object.keys(patch.set)).toEqual(['b'])
  })

  it('reports a new key', () => {
    expect(diffVariableValues({}, { fresh: 'v' }).set).toEqual({ fresh: 'v' })
  })

  it('reports a removed key', () => {
    // Renames delete the old key, and mergeVariableValues prunes unreferenced
    // ones. Without this the server would resurrect them.
    const patch = diffVariableValues({ old: 'v', keep: 'k' }, { keep: 'k' })
    expect(patch.remove).toEqual(['old'])
    expect(patch.set).toEqual({})
  })

  it('a rename is one set plus one remove', () => {
    const patch = diffVariableValues({ 'x.old': 'v' }, { 'x.new': 'v' })
    expect(patch.set).toEqual({ 'x.new': 'v' })
    expect(patch.remove).toEqual(['x.old'])
  })

  it('an empty string is a value, not a removal', () => {
    // Clearing a field is a deliberate edit and must reach the server as one.
    const patch = diffVariableValues({ a: 'v' }, { a: '' })
    expect(patch.set).toEqual({ a: '' })
    expect(patch.remove).toEqual([])
  })

  it('no change produces an empty patch', () => {
    const patch = diffVariableValues({ a: '1' }, { a: '1' })
    expect(patch.set).toEqual({})
    expect(patch.remove).toEqual([])
  })
})
