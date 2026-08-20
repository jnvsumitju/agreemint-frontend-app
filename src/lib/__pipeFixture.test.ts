import { describe, it } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { applyPipes, parseVariableExpression } from './variablePipes'

/**
 * Emits the canvas's own pipe output as a fixture the backend asserts against.
 *
 * <p>Not a test of this file — a generator. The PDF renderer has to format a
 * piped variable byte-identically to the canvas, and the only way to be sure is
 * to run the real implementation and hand the answers to the other language.
 * Guessing at Intl.NumberFormat's output from Java is how "close enough"
 * divergence gets shipped.
 */
const CASES: { value: unknown; expr: string }[] = [
  { value: 2400, expr: 'x | currency' },
  { value: 2400, expr: 'x | currency:"INR"' },
  { value: 2400.5, expr: 'x | currency:"EUR"' },
  { value: -5, expr: 'x | currency' },
  { value: 0, expr: 'x | currency' },
  { value: 'abc', expr: 'x | currency' },
  { value: 1234.5678, expr: 'x | number' },
  { value: 1234.5678, expr: 'x | number:0' },
  { value: 1234.5678, expr: 'x | number:3' },
  { value: 'abc', expr: 'x | number' },
  { value: 'hello world', expr: 'x | uppercase' },
  { value: 'HELLO World', expr: 'x | lowercase' },
  { value: 'hello world again', expr: 'x | capitalize' },
  { value: "o'brien mc-do", expr: 'x | capitalize' },
  { value: 'abcdefghij', expr: 'x | truncate:5' },
  { value: 'abc', expr: 'x | truncate:5' },
  { value: '', expr: 'x | default:"n/a"' },
  { value: '   ', expr: 'x | default:"n/a"' },
  { value: 'set', expr: 'x | default:"n/a"' },
  { value: null, expr: 'x | default:"n/a"' },
  { value: '2026-08-20', expr: 'x | date' },
  { value: '2026-08-20', expr: 'x | date:"DD MMM YYYY"' },
  { value: '2026-01-05', expr: 'x | date:"MM/DD/YYYY"' },
  { value: 'not a date', expr: 'x | date' },
  { value: 2400, expr: 'x | number:2 | default:"n/a"' },
  { value: 'hi', expr: 'x | uppercase | truncate:1' },
  { value: 'hi', expr: 'x | nosuchpipe' },
  // Grouping: en-US and en-IN agree below 100,000 and diverge above it
  // (1,234,567 vs 12,34,567). Without a large value the locale is untested.
  { value: 1234567, expr: 'x | currency:"INR"' },
  { value: 1234567.89, expr: 'x | currency' },
  { value: 1234567, expr: 'x | number:0' },
  // Exact ties, where HALF_UP and HALF_EVEN disagree.
  { value: 2.5, expr: 'x | number:0' },
  { value: 3.5, expr: 'x | number:0' },
  { value: -2.5, expr: 'x | number:0' },
  { value: 0.125, expr: 'x | number:2' },
  { value: 1.005, expr: 'x | number:2' },
  { value: 2.675, expr: 'x | number:2' },
  // Zero-decimal currency.
  { value: 2400, expr: 'x | currency:"JPY"' },
]

describe('pipe parity fixture', () => {
  it('writes the expected outputs for the backend to match', () => {
    const rows = CASES.map(({ value, expr }) => {
      const parsed = parseVariableExpression(expr)
      return { value, expr, expected: applyPipes(value, parsed.pipes) }
    })
    const out = join(
      dirname(new URL(import.meta.url).pathname),
      '../../../agreemint-backend-app/src/test/resources/pipe-parity.json'
    )
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(rows, null, 2) + '\n')
  })
})
