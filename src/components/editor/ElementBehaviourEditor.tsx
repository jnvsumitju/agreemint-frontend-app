import type { LayoutElement } from '../../types/layout'
import type {
  BehaviourColorRule,
  BehaviourConditionOp,
  BehaviourTableCellRule,
  BehaviourTableRowRule,
  ElementBehaviour,
} from '../../types/layoutBehaviour'

const OPS: BehaviourConditionOp[] = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'defined',
]

function appendVarToken(cur: string, token: string) {
  const c = cur.trimEnd()
  return c ? `${c} ${token}` : token
}

function VarKeyInsertSelect({
  keys,
  onInsert,
  id,
}: {
  keys: string[]
  onInsert: (token: string) => void
  id: string
}) {
  if (keys.length === 0) return null
  return (
    <select
      id={id}
      name={id}
      className="shrink-0 rounded border border-zinc-300 bg-white px-1 py-0.5 text-[10px] dark:border-zinc-600 dark:bg-zinc-800"
      aria-label="Insert variable"
      value=""
      onChange={(e) => {
        const k = e.target.value
        if (k) onInsert(`{{${k}}}`)
        e.target.selectedIndex = 0
      }}
    >
      <option value="">var…</option>
      {keys.map((k) => (
        <option key={k} value={k}>
          {k}
        </option>
      ))}
    </select>
  )
}

function emptyCondition() {
  return { left: '{{status}}', op: 'eq' as BehaviourConditionOp, right: 'active' }
}

export function ElementBehaviourEditor({
  el,
  onPatch,
  variableKeyOptions = [],
}: {
  el: LayoutElement
  onPatch: (p: Partial<LayoutElement>) => void
  /** Declared + template keys for this page (Variables tab + content on canvas). */
  variableKeyOptions?: string[]
}) {
  const b = el.behaviour ?? {}

  const setBehaviour = (next: ElementBehaviour | undefined) => {
    onPatch({
      behaviour:
        next && Object.keys(next).length > 0
          ? { ...next, behaviourVersion: next.behaviourVersion ?? 1 }
          : undefined,
    })
  }

  const patchB = (partial: Partial<ElementBehaviour>) => {
    setBehaviour({ ...b, ...partial })
  }

  const visibilityRules = b.visibilityRules ?? []
  const colorRules = b.colorRules ?? []
  const fid = (...parts: (string | number)[]) => `ag-eb-${el.id}-${parts.join('-')}`

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-900 dark:bg-violet-950/25">
      <p className="text-xs font-semibold text-violet-900 dark:text-violet-200">Dynamic behaviour</p>
      <p className="text-[10px] leading-snug text-zinc-600 dark:text-zinc-400">
        Rules use Variables data (dotted paths or <code className="font-mono">{'{{key}}'}</code> in fields).
        PDF output uses the same logic as the canvas preview.
      </p>

      <label className="flex items-center gap-2 text-xs">
        <input
          id={fid('visibility-default')}
          name={fid('visibility-default')}
          type="checkbox"
          checked={b.visibilityDefaultShow !== false}
          onChange={(e) => patchB({ visibilityDefaultShow: e.target.checked })}
        />
        Visible by default (when no visibility rule matches)
      </label>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">Visibility rules</span>
          <button
            type="button"
            className="text-[11px] text-violet-700 underline dark:text-violet-300"
            onClick={() =>
              patchB({
                visibilityRules: [...visibilityRules, { when: emptyCondition(), show: false }],
              })
            }
          >
            Add rule
          </button>
        </div>
        {visibilityRules.map((rule, i) => (
          <div
            key={i}
            className="flex flex-col gap-1 rounded border border-zinc-200 bg-white/90 p-2 dark:border-zinc-600 dark:bg-zinc-900/60"
          >
            <label className="text-[10px] font-medium text-zinc-600">When</label>
            <div className="flex gap-1">
              <input
                id={fid('vis', i, 'left')}
                name={fid('vis', i, 'left')}
                className="min-w-0 flex-1 rounded border border-zinc-300 px-1 py-0.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
                value={String(rule.when.left)}
                onChange={(e) => {
                  const next = [...visibilityRules]
                  next[i] = { ...rule, when: { ...rule.when, left: e.target.value } }
                  patchB({ visibilityRules: next })
                }}
              />
              <VarKeyInsertSelect
                id={fid('vis', i, 'ins-left')}
                keys={variableKeyOptions}
                onInsert={(token) => {
                  const next = [...visibilityRules]
                  next[i] = {
                    ...rule,
                    when: { ...rule.when, left: appendVarToken(String(rule.when.left), token) },
                  }
                  patchB({ visibilityRules: next })
                }}
              />
            </div>
            <select
              id={fid('vis', i, 'op')}
              name={fid('vis', i, 'op')}
              className="rounded border border-zinc-300 text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
              value={rule.when.op}
              onChange={(e) => {
                const next = [...visibilityRules]
                next[i] = {
                  ...rule,
                  when: { ...rule.when, op: e.target.value as BehaviourConditionOp },
                }
                patchB({ visibilityRules: next })
              }}
            >
              {OPS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            {rule.when.op !== 'defined' && (
              <div className="flex gap-1">
                <input
                  id={fid('vis', i, 'right')}
                  name={fid('vis', i, 'right')}
                  className="min-w-0 flex-1 rounded border border-zinc-300 px-1 py-0.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
                  placeholder="Right / compare to"
                  value={rule.when.right != null ? String(rule.when.right) : ''}
                  onChange={(e) => {
                    const next = [...visibilityRules]
                    next[i] = { ...rule, when: { ...rule.when, right: e.target.value } }
                    patchB({ visibilityRules: next })
                  }}
                />
                <VarKeyInsertSelect
                  id={fid('vis', i, 'ins-right')}
                  keys={variableKeyOptions}
                  onInsert={(token) => {
                    const next = [...visibilityRules]
                    next[i] = {
                      ...rule,
                      when: {
                        ...rule.when,
                        right: appendVarToken(
                          rule.when.right != null ? String(rule.when.right) : '',
                          token
                        ),
                      },
                    }
                    patchB({ visibilityRules: next })
                  }}
                />
              </div>
            )}
            <label className="mt-1 flex items-center gap-2 text-[11px]">
              <input
                id={fid('vis', i, 'show')}
                name={fid('vis', i, 'show')}
                type="checkbox"
                checked={rule.show}
                onChange={(e) => {
                  const next = [...visibilityRules]
                  next[i] = { ...rule, show: e.target.checked }
                  patchB({ visibilityRules: next })
                }}
              />
              Show element when true
            </label>
            <button
              type="button"
              className="self-end text-[10px] text-red-600 dark:text-red-400"
              onClick={() => patchB({ visibilityRules: visibilityRules.filter((_, j) => j !== i) })}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">Color rules</span>
          <button
            type="button"
            className="text-[11px] text-violet-700 underline dark:text-violet-300"
            onClick={() =>
              patchB({
                colorRules: [
                  ...colorRules,
                  { when: emptyCondition(), strokeColor: '#0f172a', fillColor: '#fef3c7' },
                ],
              })
            }
          >
            Add rule
          </button>
        </div>
        {colorRules.map((rule: BehaviourColorRule, i) => (
          <div
            key={i}
            className="flex flex-col gap-1 rounded border border-zinc-200 bg-white/90 p-2 dark:border-zinc-600 dark:bg-zinc-900/60"
          >
            <span className="text-[10px] font-medium text-zinc-600">When</span>
            <div className="flex gap-1">
              <input
                id={fid('col', i, 'left')}
                name={fid('col', i, 'left')}
                className="min-w-0 flex-1 rounded border border-zinc-300 px-1 py-0.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
                value={String(rule.when.left)}
                onChange={(e) => {
                  const next = [...colorRules]
                  next[i] = { ...rule, when: { ...rule.when, left: e.target.value } }
                  patchB({ colorRules: next })
                }}
              />
              <VarKeyInsertSelect
                id={fid('col', i, 'ins-left')}
                keys={variableKeyOptions}
                onInsert={(token) => {
                  const next = [...colorRules]
                  next[i] = {
                    ...rule,
                    when: { ...rule.when, left: appendVarToken(String(rule.when.left), token) },
                  }
                  patchB({ colorRules: next })
                }}
              />
            </div>
            <select
              id={fid('col', i, 'op')}
              name={fid('col', i, 'op')}
              className="rounded border border-zinc-300 text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
              value={rule.when.op}
              onChange={(e) => {
                const next = [...colorRules]
                next[i] = {
                  ...rule,
                  when: { ...rule.when, op: e.target.value as BehaviourConditionOp },
                }
                patchB({ colorRules: next })
              }}
            >
              {OPS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            {rule.when.op !== 'defined' && (
              <div className="flex gap-1">
                <input
                  id={fid('col', i, 'right')}
                  name={fid('col', i, 'right')}
                  className="min-w-0 flex-1 rounded border border-zinc-300 px-1 py-0.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
                  value={rule.when.right != null ? String(rule.when.right) : ''}
                  onChange={(e) => {
                    const next = [...colorRules]
                    next[i] = { ...rule, when: { ...rule.when, right: e.target.value } }
                    patchB({ colorRules: next })
                  }}
                />
                <VarKeyInsertSelect
                  id={fid('col', i, 'ins-right')}
                  keys={variableKeyOptions}
                  onInsert={(token) => {
                    const next = [...colorRules]
                    next[i] = {
                      ...rule,
                      when: {
                        ...rule.when,
                        right: appendVarToken(
                          rule.when.right != null ? String(rule.when.right) : '',
                          token
                        ),
                      },
                    }
                    patchB({ colorRules: next })
                  }}
                />
              </div>
            )}
            <label className="text-[10px] font-medium text-zinc-600">Stroke / text color</label>
            <input
              id={fid('col', i, 'stroke')}
              name={fid('col', i, 'stroke')}
              type="text"
              className="rounded border border-zinc-300 px-1 py-0.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
              value={rule.strokeColor ?? ''}
              onChange={(e) => {
                const next = [...colorRules]
                next[i] = { ...rule, strokeColor: e.target.value }
                patchB({ colorRules: next })
              }}
            />
            <label className="text-[10px] font-medium text-zinc-600">Fill / background</label>
            <input
              id={fid('col', i, 'fill')}
              name={fid('col', i, 'fill')}
              type="text"
              className="rounded border border-zinc-300 px-1 py-0.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
              value={rule.fillColor ?? ''}
              onChange={(e) => {
                const next = [...colorRules]
                next[i] = { ...rule, fillColor: e.target.value }
                patchB({ colorRules: next })
              }}
            />
            <button
              type="button"
              className="self-end text-[10px] text-red-600 dark:text-red-400"
              onClick={() => patchB({ colorRules: colorRules.filter((_, j) => j !== i) })}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="rounded border border-zinc-200 bg-white/90 p-2 dark:border-zinc-600 dark:bg-zinc-900/60">
        <p className="mb-1 text-[11px] font-medium text-zinc-700 dark:text-zinc-200">Dynamic size</p>
        <label className="flex flex-col gap-0.5 text-[10px]">
          Width expression
          <div className="flex gap-1">
            <input
              id={fid('size', 'widthExpr')}
              name={fid('size', 'widthExpr')}
              className="min-w-0 flex-1 rounded border border-zinc-300 px-1 py-0.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
              placeholder="clamp({{barPct}}*200,20,200)"
              value={b.size?.widthExpr ?? ''}
              onChange={(e) =>
                patchB({
                  size: { ...b.size, widthExpr: e.target.value || undefined },
                })
              }
            />
            <VarKeyInsertSelect
              id={fid('size', 'ins-width')}
              keys={variableKeyOptions}
              onInsert={(token) =>
                patchB({
                  size: {
                    ...b.size,
                    widthExpr: appendVarToken(b.size?.widthExpr ?? '', token) || undefined,
                  },
                })
              }
            />
          </div>
        </label>
        <label className="mt-1 flex flex-col gap-0.5 text-[10px]">
          Height expression
          <div className="flex gap-1">
            <input
              id={fid('size', 'heightExpr')}
              name={fid('size', 'heightExpr')}
              className="min-w-0 flex-1 rounded border border-zinc-300 px-1 py-0.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
              value={b.size?.heightExpr ?? ''}
              onChange={(e) =>
                patchB({
                  size: { ...b.size, heightExpr: e.target.value || undefined },
                })
              }
            />
            <VarKeyInsertSelect
              id={fid('size', 'ins-height')}
              keys={variableKeyOptions}
              onInsert={(token) =>
                patchB({
                  size: {
                    ...b.size,
                    heightExpr: appendVarToken(b.size?.heightExpr ?? '', token) || undefined,
                  },
                })
              }
            />
          </div>
        </label>
        <div className="mt-1 grid grid-cols-2 gap-1">
          {(['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const).map((k) => (
            <label key={k} className="flex flex-col gap-0.5 text-[10px]">
              {k}
              <input
                id={fid('size', k)}
                name={fid('size', k)}
                type="number"
                className="rounded border border-zinc-300 px-1 py-0.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
                value={b.size?.[k] ?? ''}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  patchB({
                    size: {
                      ...b.size,
                      [k]: Number.isFinite(n) ? n : undefined,
                    },
                  })
                }}
              />
            </label>
          ))}
        </div>
      </div>

      {(el.type === 'TEXT' || el.type === 'HEADER' || el.type === 'FOOTER') && (
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="font-medium text-zinc-700 dark:text-zinc-200">Text overflow</span>
          <select
            id={fid('text-overflow-mode')}
            name={fid('text-overflow-mode')}
            className="rounded border border-zinc-300 text-xs dark:border-zinc-600 dark:bg-zinc-800"
            value={b.textOverflow?.mode ?? ''}
            onChange={(e) => {
              const v = e.target.value
              patchB({
                textOverflow: v
                  ? { mode: v as 'clip' | 'ellipsis' | 'shrinkToFit', minFontSize: b.textOverflow?.minFontSize }
                  : undefined,
              })
            }}
          >
            <option value="">Default</option>
            <option value="clip">clip</option>
            <option value="ellipsis">ellipsis</option>
            <option value="shrinkToFit">shrinkToFit</option>
          </select>
          <input
            id={fid('text-overflow-min-font')}
            name={fid('text-overflow-min-font')}
            type="number"
            className="rounded border border-zinc-300 px-1 py-0.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
            placeholder="min font (shrinkToFit)"
            value={b.textOverflow?.minFontSize ?? ''}
            onChange={(e) => {
              const n = Number(e.target.value)
              patchB({
                textOverflow: b.textOverflow?.mode
                  ? {
                      mode: b.textOverflow.mode,
                      minFontSize: Number.isFinite(n) ? n : undefined,
                    }
                  : undefined,
              })
            }}
          />
        </label>
      )}

      {el.type === 'IMAGE' && (
        <label className="flex flex-col gap-1 text-[11px]">
          <span className="font-medium text-zinc-700 dark:text-zinc-200">Image URL expression</span>
          <div className="flex gap-1">
            <input
              id={fid('image-src-expr')}
              name={fid('image-src-expr')}
              className="min-w-0 flex-1 rounded border border-zinc-300 px-1 py-0.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
              placeholder="{{logoUrl}}"
              value={b.imageSrcExpr ?? ''}
              onChange={(e) => patchB({ imageSrcExpr: e.target.value || undefined })}
            />
            <VarKeyInsertSelect
              id={fid('image-src-expr-ins')}
              keys={variableKeyOptions}
              onInsert={(token) =>
                patchB({
                  imageSrcExpr: appendVarToken(b.imageSrcExpr ?? '', token) || undefined,
                })
              }
            />
          </div>
          <span className="text-[10px] text-zinc-500">PDF allows http(s) and data:image URLs only.</span>
        </label>
      )}

      {el.type === 'TABLE' && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-medium text-zinc-700 dark:text-zinc-200">Table row / cell rules</p>
          <button
            type="button"
            className="self-start text-[11px] text-violet-700 underline dark:text-violet-300"
            onClick={() => {
              const rowRules = [...(b.table?.rowRules ?? [])]
              rowRules.push({ when: emptyCondition(), hide: true })
              patchB({ table: { ...b.table, rowRules } })
            }}
          >
            Add row hide rule
          </button>
          {(b.table?.rowRules ?? []).map((rule: BehaviourTableRowRule, i) => (
            <div
              key={`rr-${i}`}
              className="flex flex-col gap-1 rounded border border-zinc-200 bg-white/90 p-2 dark:border-zinc-600 dark:bg-zinc-900/60"
            >
              <span className="text-[10px]">When (hide row)</span>
              <div className="flex gap-1">
                <input
                  id={fid('trow', i, 'left')}
                  name={fid('trow', i, 'left')}
                  className="min-w-0 flex-1 font-mono text-[11px]"
                  value={String(rule.when.left)}
                  onChange={(e) => {
                    const rowRules = [...(b.table?.rowRules ?? [])]
                    rowRules[i] = { ...rule, when: { ...rule.when, left: e.target.value } }
                    patchB({ table: { ...b.table, rowRules } })
                  }}
                />
                <VarKeyInsertSelect
                  id={fid('trow', i, 'ins-left')}
                  keys={variableKeyOptions}
                  onInsert={(token) => {
                    const rowRules = [...(b.table?.rowRules ?? [])]
                    rowRules[i] = {
                      ...rule,
                      when: { ...rule.when, left: appendVarToken(String(rule.when.left), token) },
                    }
                    patchB({ table: { ...b.table, rowRules } })
                  }}
                />
              </div>
              <select
                id={fid('trow', i, 'op')}
                name={fid('trow', i, 'op')}
                className="text-[11px]"
                value={rule.when.op}
                onChange={(e) => {
                  const rowRules = [...(b.table?.rowRules ?? [])]
                  rowRules[i] = {
                    ...rule,
                    when: { ...rule.when, op: e.target.value as BehaviourConditionOp },
                  }
                  patchB({ table: { ...b.table, rowRules } })
                }}
              >
                {OPS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
              {rule.when.op !== 'defined' && (
                <div className="flex gap-1">
                  <input
                    id={fid('trow', i, 'right')}
                    name={fid('trow', i, 'right')}
                    className="min-w-0 flex-1 font-mono text-[11px]"
                    value={rule.when.right != null ? String(rule.when.right) : ''}
                    onChange={(e) => {
                      const rowRules = [...(b.table?.rowRules ?? [])]
                      rowRules[i] = { ...rule, when: { ...rule.when, right: e.target.value } }
                      patchB({ table: { ...b.table, rowRules } })
                    }}
                  />
                  <VarKeyInsertSelect
                    id={fid('trow', i, 'ins-right')}
                    keys={variableKeyOptions}
                    onInsert={(token) => {
                      const rowRules = [...(b.table?.rowRules ?? [])]
                      rowRules[i] = {
                        ...rule,
                        when: {
                          ...rule.when,
                          right: appendVarToken(
                            rule.when.right != null ? String(rule.when.right) : '',
                            token
                          ),
                        },
                      }
                      patchB({ table: { ...b.table, rowRules } })
                    }}
                  />
                </div>
              )}
              <label className="flex items-center gap-2 text-[11px]">
                <input
                  id={fid('trow', i, 'hide')}
                  name={fid('trow', i, 'hide')}
                  type="checkbox"
                  checked={!!rule.hide}
                  onChange={(e) => {
                    const rowRules = [...(b.table?.rowRules ?? [])]
                    rowRules[i] = { ...rule, hide: e.target.checked }
                    patchB({ table: { ...b.table, rowRules } })
                  }}
                />
                Hide row
              </label>
              <button
                type="button"
                className="text-[10px] text-red-600"
                onClick={() => {
                  const rowRules = (b.table?.rowRules ?? []).filter((_, j) => j !== i)
                  patchB({ table: { ...b.table, rowRules } })
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="self-start text-[11px] text-violet-700 underline dark:text-violet-300"
            onClick={() => {
              const cellRules = [...(b.table?.cellRules ?? [])]
              cellRules.push({
                when: emptyCondition(),
                colIndex: 0,
                textColor: '#b91c1c',
              })
              patchB({ table: { ...b.table, cellRules } })
            }}
          >
            Add cell style rule
          </button>
          {(b.table?.cellRules ?? []).map((rule: BehaviourTableCellRule, i) => (
            <div
              key={`cr-${i}`}
              className="flex flex-col gap-1 rounded border border-zinc-200 bg-white/90 p-2 dark:border-zinc-600 dark:bg-zinc-900/60"
            >
              <label className="text-[10px]">
                Column index
                <input
                  id={fid('tcell', i, 'col')}
                  name={fid('tcell', i, 'col')}
                  type="number"
                  min={0}
                  className="ml-1 w-14 rounded border border-zinc-300 px-1 text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
                  value={rule.colIndex}
                  onChange={(e) => {
                    const cellRules = [...(b.table?.cellRules ?? [])]
                    cellRules[i] = { ...rule, colIndex: Math.max(0, Number(e.target.value) || 0) }
                    patchB({ table: { ...b.table, cellRules } })
                  }}
                />
              </label>
              <div className="flex gap-1">
                <input
                  id={fid('tcell', i, 'left')}
                  name={fid('tcell', i, 'left')}
                  className="min-w-0 flex-1 font-mono text-[11px]"
                  value={String(rule.when.left)}
                  onChange={(e) => {
                    const cellRules = [...(b.table?.cellRules ?? [])]
                    cellRules[i] = { ...rule, when: { ...rule.when, left: e.target.value } }
                    patchB({ table: { ...b.table, cellRules } })
                  }}
                />
                <VarKeyInsertSelect
                  id={fid('tcell', i, 'ins-left')}
                  keys={variableKeyOptions}
                  onInsert={(token) => {
                    const cellRules = [...(b.table?.cellRules ?? [])]
                    cellRules[i] = {
                      ...rule,
                      when: { ...rule.when, left: appendVarToken(String(rule.when.left), token) },
                    }
                    patchB({ table: { ...b.table, cellRules } })
                  }}
                />
              </div>
              <select
                id={fid('tcell', i, 'op')}
                name={fid('tcell', i, 'op')}
                className="text-[11px]"
                value={rule.when.op}
                onChange={(e) => {
                  const cellRules = [...(b.table?.cellRules ?? [])]
                  cellRules[i] = {
                    ...rule,
                    when: { ...rule.when, op: e.target.value as BehaviourConditionOp },
                  }
                  patchB({ table: { ...b.table, cellRules } })
                }}
              >
                {OPS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
              {rule.when.op !== 'defined' && (
                <div className="flex gap-1">
                  <input
                    id={fid('tcell', i, 'right')}
                    name={fid('tcell', i, 'right')}
                    className="min-w-0 flex-1 font-mono text-[11px]"
                    value={rule.when.right != null ? String(rule.when.right) : ''}
                    onChange={(e) => {
                      const cellRules = [...(b.table?.cellRules ?? [])]
                      cellRules[i] = { ...rule, when: { ...rule.when, right: e.target.value } }
                      patchB({ table: { ...b.table, cellRules } })
                    }}
                  />
                  <VarKeyInsertSelect
                    id={fid('tcell', i, 'ins-right')}
                    keys={variableKeyOptions}
                    onInsert={(token) => {
                      const cellRules = [...(b.table?.cellRules ?? [])]
                      cellRules[i] = {
                        ...rule,
                        when: {
                          ...rule.when,
                          right: appendVarToken(
                            rule.when.right != null ? String(rule.when.right) : '',
                            token
                          ),
                        },
                      }
                      patchB({ table: { ...b.table, cellRules } })
                    }}
                  />
                </div>
              )}
              <input
                id={fid('tcell', i, 'textColor')}
                name={fid('tcell', i, 'textColor')}
                placeholder="text color"
                className="text-[11px]"
                value={rule.textColor ?? ''}
                onChange={(e) => {
                  const cellRules = [...(b.table?.cellRules ?? [])]
                  cellRules[i] = { ...rule, textColor: e.target.value || undefined }
                  patchB({ table: { ...b.table, cellRules } })
                }}
              />
              <input
                id={fid('tcell', i, 'bg')}
                name={fid('tcell', i, 'bg')}
                placeholder="cell background"
                className="text-[11px]"
                value={rule.backgroundColor ?? ''}
                onChange={(e) => {
                  const cellRules = [...(b.table?.cellRules ?? [])]
                  cellRules[i] = { ...rule, backgroundColor: e.target.value || undefined }
                  patchB({ table: { ...b.table, cellRules } })
                }}
              />
              <button
                type="button"
                className="text-[10px] text-red-600"
                onClick={() => {
                  const cellRules = (b.table?.cellRules ?? []).filter((_, j) => j !== i)
                  patchB({ table: { ...b.table, cellRules } })
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {(b.visibilityRules?.length ||
        b.colorRules?.length ||
        b.size?.widthExpr ||
        b.size?.heightExpr ||
        b.textOverflow ||
        b.imageSrcExpr ||
        b.table) && (
        <button
          type="button"
          className="text-[11px] text-red-700 underline dark:text-red-400"
          onClick={() => setBehaviour(undefined)}
        >
          Clear all behaviour
        </button>
      )}
    </div>
  )
}
