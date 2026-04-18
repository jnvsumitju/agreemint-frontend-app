import type { LayoutElement } from '../../types/layout'
import type {
  BehaviourColorRule,
  BehaviourConditionOp,
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
  return { left: '', op: 'eq' as BehaviourConditionOp, right: '' }
}

// ── Dynamic size builder ─────────────────────────────────────────────────────

/**
 * The stored value for Width/Height is still a free-form expression string so
 * advanced users can drop in clamp()/arithmetic. For everyone else we expose
 * three modes and round-trip the common "scale with a variable" case through a
 * simple dropdown + number input.
 *
 * Detection rules for loading an existing expression:
 *   (empty)                     → fixed
 *   {{var}}*N                   → scale  (parsed)
 *   anything else               → custom (shows raw textbox)
 */
type SizeMode = 'fixed' | 'scale' | 'custom'

function detectSizeMode(expr: string | undefined | null): SizeMode {
  const s = (expr ?? '').trim()
  if (!s) return 'fixed'
  if (/^\{\{[\w.]+\}\}\s*\*\s*\d+(\.\d+)?$/.test(s)) return 'scale'
  return 'custom'
}

function parseScaleExpr(
  expr: string | undefined | null
): { varKey: string; multiplier: number } | null {
  if (!expr) return null
  const m = /^\{\{([\w.]+)\}\}\s*\*\s*(\d+(?:\.\d+)?)$/.exec(expr.trim())
  if (!m) return null
  return { varKey: m[1], multiplier: Number(m[2]) }
}

function buildScaleExpr(varKey: string, multiplier: number): string {
  return `{{${varKey}}}*${multiplier}`
}

function SizeDimensionBuilder({
  label,
  value,
  onChange,
  keys,
  idPrefix,
}: {
  label: 'Width' | 'Height'
  value: string | undefined
  onChange: (next: string | undefined) => void
  keys: string[]
  idPrefix: string
}) {
  const mode = detectSizeMode(value)
  const scaleParsed = mode === 'scale' ? parseScaleExpr(value) : null
  const [draftVar, setDraftVar] = (function useDraftVar() {
    // Intentionally not useState — we derive from the expression so load/save
    // round-trips through the stored string. The parent drives the value.
    return [scaleParsed?.varKey ?? keys[0] ?? '', () => {}] as const
  })()
  void setDraftVar // keep lint quiet — placeholder for future local caret/caret-less state

  const updateMode = (next: SizeMode) => {
    if (next === 'fixed') return onChange(undefined)
    if (next === 'scale') {
      const k = scaleParsed?.varKey ?? draftVar ?? keys[0] ?? ''
      const mult = scaleParsed?.multiplier ?? 1
      if (k) onChange(buildScaleExpr(k, mult))
      return
    }
    // custom: keep the current expression if it isn't empty, otherwise
    // seed with an example so users have something to edit.
    if (!value || !value.trim()) {
      onChange('clamp({{var}}*200,20,200)')
    }
  }

  const setScale = (partial: { varKey?: string; multiplier?: number }) => {
    const varKey = partial.varKey ?? scaleParsed?.varKey ?? keys[0] ?? ''
    const multiplier = partial.multiplier ?? scaleParsed?.multiplier ?? 1
    if (!varKey) return
    onChange(buildScaleExpr(varKey, multiplier))
  }

  return (
    <div className="flex flex-col gap-1 text-[10px]">
      <div className="flex items-center gap-2">
        <span className="font-medium">{label}</span>
        <select
          id={`${idPrefix}-mode`}
          name={`${idPrefix}-mode`}
          className="rounded border border-zinc-300 bg-white px-1 py-0.5 text-[10px] dark:border-zinc-600 dark:bg-zinc-800"
          value={mode}
          onChange={(e) => updateMode(e.target.value as SizeMode)}
          aria-label={`${label} sizing mode`}
        >
          <option value="fixed">Fixed</option>
          <option value="scale" disabled={keys.length === 0}>
            Scale with variable{keys.length === 0 ? ' (declare one first)' : ''}
          </option>
          <option value="custom">Custom formula…</option>
        </select>
      </div>

      {mode === 'fixed' && (
        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
          Uses the element's base {label.toLowerCase()} as-is.
        </p>
      )}

      {mode === 'scale' && (
        <div className="flex items-center gap-1">
          <select
            id={`${idPrefix}-scale-var`}
            name={`${idPrefix}-scale-var`}
            className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-1 py-0.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
            value={scaleParsed?.varKey ?? ''}
            onChange={(e) => setScale({ varKey: e.target.value })}
          >
            <option value="" disabled>Pick a variable…</option>
            {keys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <span className="shrink-0 text-[10px] text-zinc-500">×</span>
          <input
            id={`${idPrefix}-scale-mult`}
            name={`${idPrefix}-scale-mult`}
            type="number"
            step="any"
            className="w-16 shrink-0 rounded border border-zinc-300 px-1 py-0.5 text-right text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
            value={scaleParsed?.multiplier ?? 1}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) setScale({ multiplier: n })
            }}
          />
          <span className="shrink-0 text-[10px] text-zinc-500">pt</span>
        </div>
      )}

      {mode === 'custom' && (
        <div className="flex gap-1">
          <input
            id={`${idPrefix}-custom`}
            name={`${idPrefix}-custom`}
            className="min-w-0 flex-1 rounded border border-zinc-300 px-1 py-0.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
            placeholder="clamp({{barPct}}*200,20,200)"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || undefined)}
          />
          <VarKeyInsertSelect
            id={`${idPrefix}-custom-ins`}
            keys={keys}
            onInsert={(token) => onChange(appendVarToken(value ?? '', token) || undefined)}
          />
        </div>
      )}
    </div>
  )
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
            <select
              id={fid('vis', i, 'left')}
              name={fid('vis', i, 'left')}
              className="rounded border border-zinc-300 px-1 py-0.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
              value={String(rule.when.left).replace(/^\{\{|\}\}$/g, '')}
              onChange={(e) => {
                const next = [...visibilityRules]
                next[i] = { ...rule, when: { ...rule.when, left: `{{${e.target.value}}}` } }
                patchB({ visibilityRules: next })
              }}
            >
              <option value="">Select variable…</option>
              {variableKeyOptions.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
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
              <input
                id={fid('vis', i, 'right')}
                name={fid('vis', i, 'right')}
                className="rounded border border-zinc-300 px-1 py-0.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
                placeholder="Right / compare to"
                value={rule.when.right != null ? String(rule.when.right) : ''}
                onChange={(e) => {
                  const next = [...visibilityRules]
                  next[i] = { ...rule, when: { ...rule.when, right: e.target.value } }
                  patchB({ visibilityRules: next })
                }}
              />
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

      {el.type !== 'TABLE' && el.type !== 'LIST' && <div className="flex flex-col gap-2">
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
      </div>}

      {el.type !== 'TABLE' && <div className="rounded border border-zinc-200 bg-white/90 p-2 dark:border-zinc-600 dark:bg-zinc-900/60">
        <p className="mb-1 text-[11px] font-medium text-zinc-700 dark:text-zinc-200">Dynamic size</p>
        <SizeDimensionBuilder
          label="Width"
          value={b.size?.widthExpr}
          keys={variableKeyOptions}
          idPrefix={fid('size', 'widthExpr')}
          onChange={(next) => patchB({ size: { ...b.size, widthExpr: next } })}
        />
        <div className="mt-1" />
        <SizeDimensionBuilder
          label="Height"
          value={b.size?.heightExpr}
          keys={variableKeyOptions}
          idPrefix={fid('size', 'heightExpr')}
          onChange={(next) => patchB({ size: { ...b.size, heightExpr: next } })}
        />
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
      </div>}

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

      {/* Table row/cell rules removed — table styles now live in the structured variable data */}

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
