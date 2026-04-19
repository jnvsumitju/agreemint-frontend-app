/**
 * Type-aware value picker for a unified rule's "set <property> to …"
 * action. Five modes in deliberate ease-of-use order so non-technical
 * users land on the simplest viable option by default:
 *
 *   Fixed  → Variable → Scale variable → Per value → Formula
 *           (last tab is clearly labelled "advanced" so it doesn't nudge)
 *
 * The picker is intentionally dumb about rule semantics — it only knows
 * how to edit a {@link RuleValue} for a given {@link BindingTarget}. The
 * parent decides when and how to persist.
 */
import { useMemo } from 'react'
import type { MappingCase, RuleValue } from '../../types/layoutBehaviour'
import type { BindingTarget } from '../../types/layoutBehaviour'
import { BINDING_TARGETS, type TargetValueKind } from '../../lib/bindingTargets'

/** All the modes that might show in the segmented control. A helper below
 *  filters down to the ones that actually make sense for the target. */
type Mode = 'fixed' | 'variable' | 'scaled' | 'mapping' | 'expression'

const MODE_LABEL: Record<Mode, string> = {
  fixed: 'Fixed',
  variable: 'From variable',
  scaled: 'Scale variable',
  mapping: 'Per value',
  expression: 'Formula',
}

function modesFor(kind: TargetValueKind): Mode[] {
  // Scale only makes sense for numbers. Variable pass-through makes
  // sense anywhere except enums (variable value as enum is too brittle).
  if (kind === 'number') return ['fixed', 'variable', 'scaled', 'mapping', 'expression']
  if (kind === 'color') return ['fixed', 'variable', 'mapping', 'expression']
  if (kind === 'imageUrl') return ['fixed', 'variable', 'mapping', 'expression']
  // enums
  return ['fixed', 'mapping', 'expression']
}

function detectMode(value: RuleValue | undefined): Mode {
  return (value?.mode ?? 'fixed') as Mode
}

interface RuleValuePickerProps {
  target: BindingTarget
  value: RuleValue | undefined
  onChange: (next: RuleValue) => void
  /** Variable keys from the Vars tab (global + local). */
  variables: string[]
  /**
   * Optional preview — when provided, shows "→ resolves to X" under the
   * picker using the current Vars preview values.
   */
  resolvePreview?: (rv: RuleValue) => string | number | undefined
}

export function RuleValuePicker({
  target,
  value,
  onChange,
  variables,
  resolvePreview,
}: RuleValuePickerProps) {
  const spec = BINDING_TARGETS[target]
  const kind = spec.valueKind
  const modes = modesFor(kind)
  const mode = detectMode(value)

  const switchMode = (next: Mode) => onChange(defaultValueForMode(next, value, spec.defaultMultiplier))

  const preview = useMemo(() => {
    if (!resolvePreview || !value) return undefined
    try {
      const v = resolvePreview(value)
      return v === undefined ? null : v
    } catch {
      return null
    }
  }, [resolvePreview, value])

  return (
    <div className="flex flex-col gap-1.5 text-[11px]">
      {/* Segmented control */}
      <div className="inline-flex flex-wrap rounded-md border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-700 dark:bg-zinc-800/60">
        {modes.map((m) => {
          const active = m === mode
          const isAdvanced = m === 'expression'
          return (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
                active
                  ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'
              } ${isAdvanced ? 'text-[10px] italic' : ''}`}
              title={isAdvanced ? 'Advanced — write a raw expression' : MODE_LABEL[m]}
            >
              {MODE_LABEL[m]}
            </button>
          )
        })}
      </div>

      {/* Mode body */}
      <div>
        {mode === 'fixed' && (
          <FixedEditor
            kind={kind}
            unit={spec.unit}
            enumValues={spec.enumValues}
            value={(value as Extract<RuleValue, { mode: 'fixed' }>)?.value ?? ''}
            onChange={(v) => onChange({ mode: 'fixed', value: v })}
          />
        )}
        {mode === 'variable' && (
          <VariablePicker
            variables={variables}
            value={(value as Extract<RuleValue, { mode: 'variable' }>)?.var ?? ''}
            onChange={(v) => onChange({ mode: 'variable', var: v })}
          />
        )}
        {mode === 'scaled' && (
          <ScaledEditor
            variables={variables}
            value={value as Extract<RuleValue, { mode: 'scaled' }>}
            unit={spec.unit}
            defaultMultiplier={spec.defaultMultiplier ?? 1}
            onChange={onChange}
          />
        )}
        {mode === 'mapping' && (
          <MappingEditor
            kind={kind}
            enumValues={spec.enumValues}
            unit={spec.unit}
            variables={variables}
            value={value as Extract<RuleValue, { mode: 'mapping' }>}
            onChange={onChange}
          />
        )}
        {mode === 'expression' && (
          <ExpressionEditor
            variables={variables}
            value={(value as Extract<RuleValue, { mode: 'expression' }>)?.expression ?? ''}
            onChange={(expression) => onChange({ mode: 'expression', expression })}
          />
        )}
      </div>

      {/* Live preview */}
      {preview !== undefined && (
        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
          {preview === null ? (
            <span className="italic text-amber-600 dark:text-amber-400">
              → couldn't resolve with current preview values
            </span>
          ) : (
            <>
              → currently <span className="font-mono text-zinc-700 dark:text-zinc-200">{String(preview)}</span>
              {spec.unit ? ` ${spec.unit}` : ''}
            </>
          )}
        </p>
      )}
    </div>
  )
}

/**
 * Build a sensible default {@link RuleValue} for a newly-selected mode so
 * the picker never renders with an empty state. If the user was already
 * referencing a variable in another mode, we preserve that reference when
 * switching to a mode that also uses a variable.
 */
function defaultValueForMode(
  mode: Mode,
  prev: RuleValue | undefined,
  defaultMultiplier: number | undefined,
): RuleValue {
  const prevVar =
    prev && 'var' in prev && typeof prev.var === 'string' ? prev.var : undefined
  switch (mode) {
    case 'fixed':
      return { mode: 'fixed', value: '' }
    case 'variable':
      return { mode: 'variable', var: prevVar ?? '' }
    case 'scaled':
      return {
        mode: 'scaled',
        var: prevVar ?? '',
        multiplier: defaultMultiplier ?? 1,
      }
    case 'mapping':
      return {
        mode: 'mapping',
        var: prevVar ?? '',
        cases: [{ match: '', value: '' }],
        fallback: '',
      }
    case 'expression':
      return {
        mode: 'expression',
        expression:
          prev && 'expression' in prev && typeof prev.expression === 'string'
            ? prev.expression
            : '',
      }
  }
}

// ─── Mode bodies ────────────────────────────────────────────────────────

function FixedEditor({
  kind,
  unit,
  enumValues,
  value,
  onChange,
}: {
  kind: TargetValueKind
  unit?: string
  enumValues?: string[]
  value: string | number
  onChange: (v: string | number) => void
}) {
  if (kind === 'color') {
    const hex = String(value || '#000000')
    return (
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={normalizeHex(hex)}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-9 shrink-0 cursor-pointer rounded border border-zinc-300 dark:border-zinc-600"
        />
        <input
          type="text"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#7c3aed"
          className="h-6 w-20 rounded border border-zinc-300 bg-white px-1 font-mono text-[11px] text-zinc-900 outline-none focus:border-violet-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
      </div>
    )
  }
  if (kind === 'lineStyle' || kind === 'textAlign') {
    return (
      <select
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 rounded border border-zinc-300 bg-white px-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
      >
        <option value="" disabled>Pick one…</option>
        {(enumValues ?? []).map((ev) => (
          <option key={ev} value={ev}>{ev}</option>
        ))}
      </select>
    )
  }
  if (kind === 'fontFamily') {
    return (
      <input
        type="text"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Inter"
        className="h-6 w-32 rounded border border-zinc-300 bg-white px-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
      />
    )
  }
  if (kind === 'imageUrl') {
    return (
      <input
        type="text"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://…"
        className="h-6 w-full rounded border border-zinc-300 bg-white px-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
      />
    )
  }
  // number
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={String(value ?? '')}
        onChange={(e) => {
          const n = Number(e.target.value)
          onChange(Number.isFinite(n) ? n : '')
        }}
        className="h-6 w-20 rounded border border-zinc-300 bg-white px-1.5 text-right text-[11px] tabular-nums dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
      />
      {unit && <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{unit}</span>}
    </div>
  )
}

function VariablePicker({
  variables,
  value,
  onChange,
}: {
  variables: string[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-6 w-40 rounded border border-zinc-300 bg-white px-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
    >
      <option value="" disabled>Pick a variable…</option>
      {variables.map((v) => <option key={v} value={v}>{v}</option>)}
    </select>
  )
}

function ScaledEditor({
  variables,
  value,
  unit,
  defaultMultiplier,
  onChange,
}: {
  variables: string[]
  value: Extract<RuleValue, { mode: 'scaled' }> | undefined
  unit?: string
  defaultMultiplier: number
  onChange: (v: RuleValue) => void
}) {
  const v = value ?? { mode: 'scaled' as const, var: '', multiplier: defaultMultiplier }
  const hasBounds = v.min != null || v.max != null
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <select
          value={v.var}
          onChange={(e) => onChange({ ...v, var: e.target.value })}
          className="h-6 w-32 rounded border border-zinc-300 bg-white px-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        >
          <option value="" disabled>Pick variable…</option>
          {variables.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <span className="text-[11px] text-zinc-500">×</span>
        <input
          type="number"
          step="any"
          value={v.multiplier}
          onChange={(e) => {
            const n = Number(e.target.value)
            onChange({ ...v, multiplier: Number.isFinite(n) ? n : 0 })
          }}
          className="h-6 w-16 rounded border border-zinc-300 bg-white px-1.5 text-right text-[11px] tabular-nums dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        {unit && <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{unit}</span>}
      </div>
      <label className="flex items-center gap-1 text-[10px] text-zinc-600 dark:text-zinc-400">
        <input
          type="checkbox"
          checked={hasBounds}
          onChange={(e) => {
            if (!e.target.checked) {
              const { min: _m, max: _M, ...rest } = v
              onChange(rest)
            } else {
              onChange({ ...v, min: 0, max: 100 })
            }
          }}
        />
        Clamp between
        {hasBounds && (
          <>
            <input
              type="number"
              value={v.min ?? ''}
              onChange={(e) => onChange({ ...v, min: Number(e.target.value) })}
              className="ml-1 h-5 w-14 rounded border border-zinc-300 bg-white px-1 text-right text-[11px] tabular-nums dark:border-zinc-600 dark:bg-zinc-800"
            />
            <span>–</span>
            <input
              type="number"
              value={v.max ?? ''}
              onChange={(e) => onChange({ ...v, max: Number(e.target.value) })}
              className="h-5 w-14 rounded border border-zinc-300 bg-white px-1 text-right text-[11px] tabular-nums dark:border-zinc-600 dark:bg-zinc-800"
            />
            {unit && <span>{unit}</span>}
          </>
        )}
      </label>
    </div>
  )
}

function MappingEditor({
  kind,
  enumValues,
  unit,
  variables,
  value,
  onChange,
}: {
  kind: TargetValueKind
  enumValues?: string[]
  unit?: string
  variables: string[]
  value: Extract<RuleValue, { mode: 'mapping' }> | undefined
  onChange: (v: RuleValue) => void
}) {
  const v = value ?? {
    mode: 'mapping' as const,
    var: '',
    cases: [{ match: '', value: '' }] as MappingCase[],
    fallback: '' as string | number,
  }

  const updateCase = (i: number, patch: Partial<MappingCase>) => {
    const cases = v.cases.map((c, idx) => (idx === i ? { ...c, ...patch } : c))
    onChange({ ...v, cases })
  }
  const removeCase = (i: number) =>
    onChange({ ...v, cases: v.cases.filter((_, idx) => idx !== i) })
  const addCase = () =>
    onChange({ ...v, cases: [...v.cases, { match: '', value: '' }] })

  return (
    <div className="flex flex-col gap-1 rounded-md border border-zinc-200 bg-zinc-50 p-1.5 dark:border-zinc-700 dark:bg-zinc-800/40">
      <div className="flex items-center gap-1 text-[10px] text-zinc-600 dark:text-zinc-400">
        <span>When</span>
        <select
          value={v.var}
          onChange={(e) => onChange({ ...v, var: e.target.value })}
          className="h-5 w-28 rounded border border-zinc-300 bg-white px-1 text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
        >
          <option value="" disabled>Pick variable…</option>
          {variables.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <span>is:</span>
      </div>
      <div className="flex flex-col gap-0.5">
        {v.cases.map((c, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              type="text"
              value={String(c.match)}
              onChange={(e) => updateCase(i, { match: e.target.value })}
              placeholder="match…"
              className="h-5 w-20 rounded border border-zinc-300 bg-white px-1 text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
            />
            <span className="text-zinc-400">→</span>
            <MappingValueInput
              kind={kind}
              enumValues={enumValues}
              unit={unit}
              value={c.value}
              onChange={(next) => updateCase(i, { value: next })}
            />
            <button
              type="button"
              onClick={() => removeCase(i)}
              disabled={v.cases.length <= 1}
              className="h-4 w-4 rounded text-zinc-400 hover:text-red-600 disabled:opacity-30"
              aria-label="Remove case"
              title="Remove case"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addCase}
          className="mt-0.5 self-start rounded border border-dashed border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:border-violet-400 hover:text-violet-600 dark:border-zinc-600 dark:text-zinc-400"
        >
          + Add case
        </button>
      </div>
      <div className="mt-1 flex items-center gap-1 border-t border-zinc-200 pt-1 dark:border-zinc-700">
        <span className="text-[10px] text-zinc-500">Otherwise →</span>
        <MappingValueInput
          kind={kind}
          enumValues={enumValues}
          unit={unit}
          value={v.fallback ?? ''}
          onChange={(next) => onChange({ ...v, fallback: next })}
        />
      </div>
    </div>
  )
}

function MappingValueInput({
  kind,
  enumValues,
  unit,
  value,
  onChange,
}: {
  kind: TargetValueKind
  enumValues?: string[]
  unit?: string
  value: string | number
  onChange: (v: string | number) => void
}) {
  // Reuse FixedEditor with a tighter layout.
  return (
    <FixedEditor
      kind={kind}
      unit={unit}
      enumValues={enumValues}
      value={value}
      onChange={onChange}
    />
  )
}

function ExpressionEditor({
  variables,
  value,
  onChange,
}: {
  variables: string[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`clamp({{var}}*200,20,200)`}
        className="h-6 flex-1 rounded border border-zinc-300 bg-white px-1.5 font-mono text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
      />
      {variables.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            const v = e.target.value
            if (!v) return
            const insert = `{{${v}}}`
            onChange(value ? `${value.trimEnd()} ${insert}` : insert)
            e.target.selectedIndex = 0
          }}
          className="h-6 rounded border border-zinc-300 bg-white px-1 text-[10px] dark:border-zinc-600 dark:bg-zinc-800"
          aria-label="Insert variable"
        >
          <option value="">var…</option>
          {variables.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      )}
    </div>
  )
}

/** Ensure a color string is a 7-char `#RRGGBB` for the native color picker. */
function normalizeHex(raw: string): string {
  const s = raw.trim()
  if (/^#[0-9a-f]{6}$/i.test(s)) return s
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
  }
  return '#000000'
}
