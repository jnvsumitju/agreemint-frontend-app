/**
 * Unified rules editor — the new home for what used to be three separate
 * sections (Visibility / Color / Dynamic size) plus the new property
 * bindings. A single list of sentence-shaped {@link RuleRow}s.
 *
 * Responsibilities:
 *  - Seed local state from either `behaviour.rules` or (as a one-time
 *    migration) the legacy fields via {@link legacyToRules}.
 *  - Render the list, the empty-state preset picker, and an add button.
 *  - On every local edit, persist the whole list via {@code patchBehaviour}.
 *    Writes BOTH the new `rules` field AND clears the legacy fields so the
 *    resolver always sees a single source of truth going forward.
 */
import { useMemo } from 'react'
import type { LayoutElement } from '../../types/layout'
import type {
  ElementBehaviour,
  Rule,
  RuleValue,
} from '../../types/layoutBehaviour'
import { legacyToRules, evaluateCondition, evaluateRuleValue } from '../../lib/unifiedRules'
import { BINDING_TARGETS } from '../../lib/bindingTargets'
import { useEditorStore } from '../../stores/editorStore'
import { variableValuesToDataTree } from '../../lib/layoutBehaviourResolve'
import { RuleRow } from './RuleRow'
import { blankCondition } from './ConditionBuilder'

interface RulesEditorProps {
  element: LayoutElement
  variables: string[]
  /**
   * Apply a patch to the element's behaviour. The editor calls this
   * whenever a rule is added/removed/edited. Caller is responsible for
   * wrapping the patch in an undo-barrier + store mutation.
   */
  onBehaviourChange: (next: ElementBehaviour | undefined) => void
}

export function RulesEditor({
  element,
  variables,
  onBehaviourChange,
}: RulesEditorProps) {
  const rules = useMemo<Rule[]>(() => {
    const b = element.behaviour
    if (b?.rules && b.rules.length > 0) return b.rules
    return legacyToRules(b)
  }, [element.behaviour])

  // Preview data for "→ currently X" hints. Pulled directly from the
  // store so rules re-evaluate as the user tweaks preview values.
  const variableValues = useEditorStore((s) => s.variableValues)
  const previewData = useMemo(
    () => variableValuesToDataTree(variableValues),
    [variableValues],
  )

  /**
   * Persist `nextRules`. When the behaviour currently holds legacy fields
   * (visibilityRules / colorRules / size / imageSrcExpr), this is also the
   * migration point — we write `rules[]` and drop the legacy fields so
   * the resolver only ever sees one format on subsequent loads.
   */
  const persistRules = (nextRules: Rule[]) => {
    const prev = element.behaviour ?? {}
    const nextBehaviour: ElementBehaviour = {
      ...prev,
      // Keep non-rule fields intact: text overflow, behaviour version,
      // table rules, default-show.
      behaviourVersion: prev.behaviourVersion ?? 1,
      rules: nextRules.length > 0 ? nextRules : undefined,
      visibilityRules: undefined,
      colorRules: undefined,
      size: undefined,
      imageSrcExpr: undefined,
      visibilityDefaultShow: prev.visibilityDefaultShow,
    }
    // Prune entirely if nothing useful remains.
    const stripped: ElementBehaviour = Object.fromEntries(
      Object.entries(nextBehaviour).filter(([, v]) => v !== undefined),
    ) as ElementBehaviour
    onBehaviourChange(Object.keys(stripped).length > 0 ? stripped : undefined)
  }

  const addRule = (seed?: Rule) =>
    persistRules([...rules, seed ?? newBlankRule()])

  const patchAt = (i: number, next: Rule) => {
    const nextRules = rules.map((r, idx) => (idx === i ? next : r))
    persistRules(nextRules)
  }

  const removeAt = (i: number) => persistRules(rules.filter((_, idx) => idx !== i))

  const moveUp = (i: number) => {
    if (i === 0) return
    const nextRules = rules.slice()
    ;[nextRules[i - 1], nextRules[i]] = [nextRules[i], nextRules[i - 1]]
    persistRules(nextRules)
  }
  const moveDown = (i: number) => {
    if (i >= rules.length - 1) return
    const nextRules = rules.slice()
    ;[nextRules[i], nextRules[i + 1]] = [nextRules[i + 1], nextRules[i]]
    persistRules(nextRules)
  }

  const currentDefaultShow = element.behaviour?.visibilityDefaultShow !== false
  const setDefaultShow = (v: boolean) => {
    const prev = element.behaviour ?? {}
    onBehaviourChange({
      ...prev,
      behaviourVersion: prev.behaviourVersion ?? 1,
      visibilityDefaultShow: v,
    })
  }

  // Build per-rule previews:
  //  - `conditionMatches` → does the `when` match current Vars data?
  //  - `resolvePreview`   → resolve the rule's `value` live so the
  //                          RuleValuePicker can show "→ currently X".
  const rulePreviews = useMemo(() => {
    return rules.map((r) => ({
      matches: evaluateCondition(r.when, previewData, null),
      resolvePreview: (rv: RuleValue): string | number | undefined => {
        if (r.action.kind !== 'set') return undefined
        const kind = BINDING_TARGETS[r.action.target].valueKind
        return evaluateRuleValue(rv, kind, previewData, null)
      },
    }))
  }, [rules, previewData])

  return (
    <div className="flex flex-col gap-3">
      <header className="flex items-start justify-between gap-2">
        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
          Rules are evaluated top-to-bottom. Drag to reorder — order = precedence.
        </p>
        {rules.length > 0 && (
          <button
            type="button"
            onClick={() => addRule()}
            className="shrink-0 rounded-md border border-violet-300 bg-white px-2 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:bg-zinc-900 dark:text-violet-200 dark:hover:bg-zinc-800"
          >
            + Add rule
          </button>
        )}
      </header>

      {rules.length === 0 ? (
        <EmptyStatePresets
          onPick={(seed) => addRule(seed)}
          onBlank={() => addRule()}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((r, i) => (
            <li key={r.id} className="relative">
              {/* Reorder controls live on the left so the card content
                  reads cleanly; a single column works well at every width. */}
              <div className="absolute -left-5 top-2 flex flex-col">
                <button
                  type="button"
                  onClick={() => moveUp(i)}
                  disabled={i === 0}
                  className="flex h-4 w-4 items-center justify-center rounded text-zinc-300 hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-20 dark:text-zinc-600 dark:hover:bg-zinc-800"
                  title="Move up"
                  aria-label={`Move rule ${i + 1} up`}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
                    <path d="M6 15l6-6 6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => moveDown(i)}
                  disabled={i === rules.length - 1}
                  className="flex h-4 w-4 items-center justify-center rounded text-zinc-300 hover:bg-zinc-100 hover:text-zinc-600 disabled:opacity-20 dark:text-zinc-600 dark:hover:bg-zinc-800"
                  title="Move down"
                  aria-label={`Move rule ${i + 1} down`}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </div>
              <RuleRow
                rule={r}
                index={i}
                element={element}
                variables={variables}
                onPatch={(next) => patchAt(i, next)}
                onRemove={() => removeAt(i)}
                resolvePreview={rulePreviews[i].resolvePreview}
                conditionMatches={r.when ? rulePreviews[i].matches : undefined}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Default-visibility footer, shown once the list has content so
          users can tell "when no rule says hide/show, the element is …" */}
      {rules.length > 0 && (
        <div className="mt-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-400">
          When no visibility rule matches, this element is{' '}
          <button
            type="button"
            onClick={() => setDefaultShow(!currentDefaultShow)}
            className="font-medium text-violet-700 underline hover:no-underline dark:text-violet-300"
          >
            {currentDefaultShow ? 'shown' : 'hidden'}
          </button>
          .
        </div>
      )}
    </div>
  )
}

// ─── Preset starters (empty state) ─────────────────────────────────────

interface Preset {
  title: string
  description: string
  makeRule: () => Rule
}

// Presets are deliberately generic — this is a template builder, not an
// invoice tool. Each one is a mechanic, not a business example. Status-based
// color mapping, "overdue" red, "draft" fade etc. were removed because they
// hard-code values from one domain and bias users toward thinking the
// builder is for that domain.
const PRESETS: Preset[] = [
  {
    title: 'Show only when a variable is set',
    description: 'Render this element only if a variable has a value at generation time.',
    makeRule: () => ({
      id: crypto.randomUUID(),
      when: {
        kind: 'compare',
        left: '{{flag}}',
        op: 'defined',
      },
      action: { kind: 'show' },
    }),
  },
  {
    title: 'Width scales with a number',
    description: 'Element width follows a numeric variable — useful for progress bars or bar charts.',
    makeRule: () => ({
      id: crypto.randomUUID(),
      action: {
        kind: 'set',
        target: 'width',
        value: { mode: 'scaled', var: 'percent', multiplier: 200, min: 20, max: 200 },
      },
    }),
  },
  {
    title: 'Hide when a list is empty',
    description: 'Remove the element if a row count is zero.',
    makeRule: () => ({
      id: crypto.randomUUID(),
      when: {
        kind: 'compare',
        left: '{{rowCount}}',
        op: 'eq',
        right: 0,
      },
      action: { kind: 'hide' },
    }),
  },
]

function EmptyStatePresets({
  onPick,
  onBlank,
}: {
  onPick: (rule: Rule) => void
  onBlank: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-2.5 py-2.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
        <p className="mb-1 font-medium">No rules on this element.</p>
        <p className="text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
          Rules let you change properties at generation time based on data.
          Pick a starter below, or add a blank rule to build your own.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.title}
            type="button"
            onClick={() => onPick(p.makeRule())}
            className="flex flex-col items-start gap-0.5 rounded-md border border-zinc-200 bg-white p-1.5 text-left text-[11px] transition-colors hover:border-violet-300 hover:bg-violet-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-violet-600 dark:hover:bg-violet-950/20"
          >
            <span className="font-medium text-zinc-800 dark:text-zinc-100">{p.title}</span>
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{p.description}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onBlank}
        className="self-start rounded-md border border-dashed border-zinc-300 px-2 py-1 text-[10px] text-zinc-500 hover:border-violet-400 hover:text-violet-600 dark:border-zinc-600 dark:text-zinc-400"
      >
        + Start from scratch
      </button>
    </div>
  )
}

function newBlankRule(): Rule {
  return {
    id: crypto.randomUUID(),
    when: blankCondition(),
    action: {
      kind: 'set',
      target: 'fillColor',
      value: { mode: 'fixed', value: '' },
    },
  }
}
