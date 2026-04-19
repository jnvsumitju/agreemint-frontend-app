/**
 * Builder for a unified rule's optional {@link Condition} tree. Renders
 * as a list of "variable / operator / value" rows; users can group rows
 * with AND / OR buttons to get arbitrary nesting.
 *
 * Internally this edits a normalised shape: `Condition = all(leaf[])` by
 * default. Hitting **+ OR** lifts the current rows into an `any` wrapper
 * (and vice versa). Nested groups render with a tinted background so the
 * structure is always legible.
 *
 * Operators are displayed in plain English to match the "no formulas"
 * philosophy; the on-disk storage keeps the existing two-letter codes so
 * legacy rules + the Java renderer keep reading the same JSON.
 */
import type { BehaviourConditionOp, Condition } from '../../types/layoutBehaviour'

const OP_LABEL: Record<BehaviourConditionOp, string> = {
  eq: 'equals',
  neq: 'does not equal',
  gt: 'is greater than',
  gte: 'is at least',
  lt: 'is less than',
  lte: 'is at most',
  in: 'is one of',
  defined: 'is set',
}

const OP_ORDER: BehaviourConditionOp[] = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'defined',
]

/** An empty condition means "always applies" — parent renders a button
 *  that swaps undefined for the shape below when the user adds a WHEN. */
export function blankCondition(): Condition {
  return {
    kind: 'all',
    of: [{ kind: 'compare', left: '', op: 'eq', right: '' }],
  }
}

interface ConditionBuilderProps {
  value: Condition
  onChange: (next: Condition) => void
  /** Declared variable keys for the left-hand dropdown. */
  variables: string[]
}

export function ConditionBuilder({ value, onChange, variables }: ConditionBuilderProps) {
  // Normalise: always edit an `all`/`any` wrapper so add/remove is uniform.
  const group: Extract<Condition, { kind: 'all' | 'any' }> =
    value.kind === 'compare' ? { kind: 'all', of: [value] } : value

  const isAnd = group.kind === 'all'

  const setChild = (i: number, next: Condition) => {
    const of = group.of.map((c, idx) => (idx === i ? next : c))
    onChange(collapse({ ...group, of }))
  }
  const addChild = () => {
    const of = [...group.of, { kind: 'compare' as const, left: '', op: 'eq' as const, right: '' }]
    onChange(collapse({ ...group, of }))
  }
  const removeChild = (i: number) => {
    const of = group.of.filter((_, idx) => idx !== i)
    if (of.length === 0) {
      onChange({ kind: 'compare', left: '', op: 'eq', right: '' })
      return
    }
    onChange(collapse({ ...group, of }))
  }
  const toggleKind = () => {
    onChange({ ...group, kind: isAnd ? 'any' : 'all' })
  }

  return (
    <div
      className={`flex flex-col gap-1 rounded-md border px-2 py-1.5 text-[11px] ${
        isAnd
          ? 'border-zinc-200 bg-zinc-50/50 dark:border-zinc-700 dark:bg-zinc-800/30'
          : 'border-amber-300 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/20'
      }`}
    >
      {group.of.map((child, i) => (
        <div key={i} className="flex items-start gap-1">
          {i > 0 && (
            <span
              className={`mt-1 rounded px-1 text-[9px] font-semibold uppercase tracking-wide ${
                isAnd
                  ? 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200'
                  : 'bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-100'
              }`}
            >
              {isAnd ? 'AND' : 'OR'}
            </span>
          )}
          <div className="flex-1">
            {child.kind === 'compare' ? (
              <CompareRow
                value={child}
                onChange={(next) => setChild(i, next)}
                variables={variables}
              />
            ) : (
              <ConditionBuilder value={child} onChange={(next) => setChild(i, next)} variables={variables} />
            )}
          </div>
          {group.of.length > 1 && (
            <button
              type="button"
              onClick={() => removeChild(i)}
              className="mt-1 h-4 w-4 shrink-0 rounded text-zinc-400 hover:text-red-600"
              aria-label="Remove condition"
              title="Remove"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={addChild}
          className="rounded border border-dashed border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:border-violet-400 hover:text-violet-600 dark:border-zinc-600 dark:text-zinc-400"
        >
          + {isAnd ? 'AND' : 'OR'}
        </button>
        <button
          type="button"
          onClick={toggleKind}
          className="rounded border border-dashed border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:border-violet-400 hover:text-violet-600 dark:border-zinc-600 dark:text-zinc-400"
          title={`Switch to ${isAnd ? 'any (OR)' : 'all (AND)'}`}
        >
          Switch to {isAnd ? 'OR' : 'AND'}
        </button>
      </div>
    </div>
  )
}

/**
 * Collapse a single-child group back into the lone child. Keeps the tree
 * shallow when the user removes one of two branches.
 */
function collapse(
  g: Extract<Condition, { kind: 'all' | 'any' }>,
): Condition {
  if (g.of.length === 1) return g.of[0]
  return g
}

function CompareRow({
  value,
  onChange,
  variables,
}: {
  value: Extract<Condition, { kind: 'compare' }>
  onChange: (next: Condition) => void
  variables: string[]
}) {
  const patch = (p: Partial<typeof value>) => onChange({ ...value, ...p })
  const needsRight = value.op !== 'defined'
  // `left` usually looks like "{{foo}}". Support both raw keys (from the
  // dropdown) and full tokens for users who paste a dotted path.
  const leftKey = /^\{\{([\w.]+)\}\}$/.exec(String(value.left))?.[1] ?? ''
  return (
    <div className="flex flex-wrap items-center gap-1">
      <select
        value={leftKey}
        onChange={(e) => patch({ left: `{{${e.target.value}}}` })}
        className="h-6 rounded border border-zinc-300 bg-white px-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
      >
        <option value="" disabled>Pick variable…</option>
        {variables.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
      <select
        value={value.op}
        onChange={(e) => patch({ op: e.target.value as BehaviourConditionOp })}
        className="h-6 rounded border border-zinc-300 bg-white px-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
      >
        {OP_ORDER.map((op) => (
          <option key={op} value={op}>{OP_LABEL[op]}</option>
        ))}
      </select>
      {needsRight && (
        <input
          type="text"
          value={String(value.right ?? '')}
          onChange={(e) => patch({ right: e.target.value })}
          placeholder={value.op === 'in' ? 'comma,separated,values' : 'value…'}
          className="h-6 w-28 rounded border border-zinc-300 bg-white px-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
      )}
    </div>
  )
}
