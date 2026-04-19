/**
 * One rule card, rendered as a sentence:
 *
 *   [#n]  [When …]   [Set / Hide / Show]  [value / target]  [enabled ⦿]  [✗]
 *
 * This is the authoring surface for a single {@link Rule}. The row
 * stores no local state — the parent {@code RulesEditor} owns the list
 * and receives `onPatch`/`onRemove` callbacks.
 */
import type { LayoutElement } from '../../types/layout'
import type { Rule, RuleAction, RuleValue } from '../../types/layoutBehaviour'
import type { BindingTarget } from '../../types/layoutBehaviour'
import {
  BINDING_TARGETS,
  groupedTargetsForElementType,
} from '../../lib/bindingTargets'
import { ConditionBuilder, blankCondition } from './ConditionBuilder'
import { RuleValuePicker } from './RuleValuePicker'

export interface RuleRowProps {
  rule: Rule
  index: number
  element: LayoutElement
  variables: string[]
  onPatch: (next: Rule) => void
  onRemove: () => void
  /**
   * Invoked with the draft rule's `value` to produce a preview resolution
   * for the current Vars data. Parent wires this to the evaluator.
   */
  resolvePreview?: (rv: RuleValue) => string | number | undefined
  /** Optional — shows "→ currently applies / does not apply" above the card. */
  conditionMatches?: boolean
}

export function RuleRow({
  rule,
  index,
  element,
  variables,
  onPatch,
  onRemove,
  resolvePreview,
  conditionMatches,
}: RuleRowProps) {
  const enabled = rule.enabled !== false
  const action = rule.action

  const setAction = (next: RuleAction) => onPatch({ ...rule, action: next })
  const setEnabled = (v: boolean) => onPatch({ ...rule, enabled: v })
  const setWhen = (next: Rule['when']) => onPatch({ ...rule, when: next })

  const grouped = groupedTargetsForElementType(element.type)

  return (
    <div
      // Stable anchor — {@link BindingIndicator} scrollIntoView's this id so
      // users can jump from a Props-panel badge straight to the rule that
      // drives that field.
      id={`rule-row-${rule.id}`}
      className={`relative flex flex-col gap-1.5 rounded-lg border p-2 text-[11px] transition-opacity ${
        enabled
          ? 'border-violet-200 bg-violet-50/40 dark:border-violet-900 dark:bg-violet-950/20'
          : 'border-zinc-200 bg-zinc-50 opacity-60 dark:border-zinc-700 dark:bg-zinc-800/50'
      }`}
    >
      {/* Header row — order number, actions */}
      <div className="flex items-center gap-1.5">
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-200 text-[10px] font-bold text-violet-800 dark:bg-violet-900 dark:text-violet-200"
          title={`Rule #${index + 1} — order determines precedence`}
        >
          {index + 1}
        </span>
        {rule.when == null && (
          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300">
            always applies
          </span>
        )}
        {conditionMatches === true && rule.when != null && (
          <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
            applies now
          </span>
        )}
        {conditionMatches === false && (
          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[9px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            doesn't apply now
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <label className="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            enabled
          </label>
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-0.5 text-zinc-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30"
            aria-label={`Remove rule ${index + 1}`}
            title="Remove rule"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* WHEN section */}
      {rule.when ? (
        <div>
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            When
          </p>
          <ConditionBuilder
            value={rule.when}
            onChange={setWhen}
            variables={variables}
          />
          <button
            type="button"
            onClick={() => setWhen(undefined)}
            className="mt-0.5 text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            Remove condition (always applies)
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setWhen(blankCondition())}
          className="self-start rounded border border-dashed border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:border-violet-400 hover:text-violet-600 dark:border-zinc-600 dark:text-zinc-400"
        >
          + Add condition
        </button>
      )}

      {/* THEN section */}
      <div>
        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Then
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <select
            value={action.kind}
            onChange={(e) => {
              const k = e.target.value as RuleAction['kind']
              if (k === 'hide') setAction({ kind: 'hide' })
              else if (k === 'show') setAction({ kind: 'show' })
              else {
                // Switching to 'set' needs a default target — pick the
                // first allowed one for this element type.
                const firstTarget = grouped[0]?.targets[0]
                if (firstTarget) {
                  setAction({
                    kind: 'set',
                    target: firstTarget,
                    value: { mode: 'fixed', value: '' },
                  })
                }
              }
            }}
            className="h-6 rounded border border-zinc-300 bg-white px-1.5 text-[11px] font-medium dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          >
            <option value="set">Set</option>
            <option value="hide">Hide element</option>
            <option value="show">Show element</option>
          </select>

          {action.kind === 'set' && (
            <>
              <select
                value={action.target}
                onChange={(e) =>
                  setAction({
                    ...action,
                    target: e.target.value as BindingTarget,
                    value: { mode: 'fixed', value: '' },
                  })
                }
                className="h-6 rounded border border-zinc-300 bg-white px-1.5 text-[11px] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {grouped.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.targets.map((t) => (
                      <option key={t} value={t}>{BINDING_TARGETS[t].label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="text-[11px] text-zinc-500">to</span>
            </>
          )}
        </div>

        {action.kind === 'set' && (
          <div className="mt-1">
            <RuleValuePicker
              target={action.target}
              value={action.value}
              onChange={(value) => setAction({ ...action, value })}
              variables={variables}
              resolvePreview={resolvePreview}
            />
          </div>
        )}
      </div>
    </div>
  )
}
