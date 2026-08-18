import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Store selectors that build a new object must be wrapped in `useShallow`.
 *
 * <p>Zustand compares snapshots by reference. A selector like
 * {@code selectAllTemplateElements}, which is `pages.flatMap(...)`, returns a
 * fresh array on every call — so an unwrapped one reports a change on every
 * render and React tears the tree down with "maximum update depth exceeded"
 * (#185). The editor becomes a full-page error boundary; there is no partial
 * failure to notice in passing.
 *
 * <p>This is a source scan rather than a render test on purpose: the suite runs
 * in a node environment with no DOM, so no component here is ever rendered and
 * nothing else in the project can catch this. It has now happened once, in
 * `PreviewIssuesPanel`, where the sibling file two directories over had it
 * right — which is exactly the kind of inconsistency a reviewer's eye slides
 * past.
 */

/** Selectors that allocate. Add to this when a new one is written. */
const ALLOCATING_SELECTORS = ['selectAllTemplateElements']

const SRC = join(import.meta.dirname, '..')

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      yield* walk(full)
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      yield full
    }
  }
}

describe('zustand selector stability', () => {
  it('never passes an allocating selector to a store hook unwrapped', () => {
    const offenders: string[] = []

    for (const file of walk(SRC)) {
      const source = readFileSync(file, 'utf8')
      for (const selector of ALLOCATING_SELECTORS) {
        // `useSomeStore(selectFoo)` — the bare form. The safe spelling is
        // `useSomeStore(useShallow(selectFoo))`, which this does not match.
        const bare = new RegExp(`use\\w*Store\\(\\s*${selector}\\s*\\)`, 'g')
        for (const hit of source.matchAll(bare)) {
          const line = source.slice(0, hit.index).split('\n').length
          offenders.push(`${file.replace(SRC, 'src')}:${line} — ${hit[0]}`)
        }
      }
    }

    expect(
      offenders,
      'wrap these in useShallow(...) — an allocating selector re-renders forever',
    ).toEqual([])
  })

  it('the scan actually reaches component source', () => {
    // Guards the guard: a broken walk would report zero offenders forever and
    // look like a pass.
    const files = [...walk(SRC)]
    expect(files.length).toBeGreaterThan(50)
    expect(files.some((f) => f.endsWith('PreviewIssuesPanel.tsx'))).toBe(true)
    // And the pattern must match the dangerous spelling when it is present.
    const bare = new RegExp(`use\\w*Store\\(\\s*selectAllTemplateElements\\s*\\)`)
    expect(bare.test('const e = useEditorStore(selectAllTemplateElements)')).toBe(true)
    expect(bare.test('const e = useEditorStore(useShallow(selectAllTemplateElements))')).toBe(false)
  })
})
