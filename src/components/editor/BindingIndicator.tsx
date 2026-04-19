/**
 * Tiny visual cues that surface rule-driven property overrides inside the
 * Properties panel. Two shapes:
 *
 *   <BindingIndicator element={el} target="width" />
 *       Inline badge to put next to a field label. Renders null when no
 *       rule writes to `target`, so it's safe to drop anywhere.
 *
 *   <BindingIndicatorSummary element={el} />
 *       Rollup at the top of the panel — lists every target currently
 *       being overridden by a rule as clickable chips.
 *
 * Both scroll the matching rule row into view on click and flash it with
 * a transient ring. Relies on {@code RuleRow} rendering an outer element
 * with `id={`rule-row-${rule.id}`}`.
 */
import type { LayoutElement } from '../../types/layout'
import type { BindingTarget, Rule } from '../../types/layoutBehaviour'
import { BINDING_TARGETS } from '../../lib/bindingTargets'
import { useEditorStore } from '../../stores/editorStore'

interface RuleHit {
  rule: Rule
  /** 0-based index in the element's rules[] — also what the UI surfaces as "#n". */
  index: number
}

/**
 * Every enabled rule that writes to `target` via a `set` action, in list
 * order. The last one wins at evaluation time (last-write-wins for sets).
 */
export function rulesTargeting(
  element: LayoutElement,
  target: BindingTarget,
): RuleHit[] {
  const rules = element.behaviour?.rules ?? []
  const out: RuleHit[] = []
  rules.forEach((rule, index) => {
    if (rule.enabled === false) return
    if (rule.action.kind !== 'set') return
    if (rule.action.target !== target) return
    out.push({ rule, index })
  })
  return out
}

/** Every enabled rule that controls visibility (hide / show actions). */
export function rulesControllingVisibility(element: LayoutElement): RuleHit[] {
  const rules = element.behaviour?.rules ?? []
  const out: RuleHit[] = []
  rules.forEach((rule, index) => {
    if (rule.enabled === false) return
    if (rule.action.kind !== 'hide' && rule.action.kind !== 'show') return
    out.push({ rule, index })
  })
  return out
}

/**
 * Jumps the user to the rule card for `ruleId`. Two-step because rule
 * rows live under the Behaviour tab while most {@link BindingIndicator}
 * badges live under the Properties tab:
 *
 *  1. Switch the sidebar to the Behaviour tab so the row is mounted.
 *  2. On the next frame (mount has to happen first) scroll it into view
 *     and briefly flash a violet ring.
 *
 * Fails silently if the row never shows up — e.g. the element got
 * deselected between click and scroll.
 */
export function focusRule(ruleId: string): void {
  useEditorStore.getState().setEditorSidebarTab('behaviour')
  // Give React a tick to mount the Behaviour tab content before we try
  // to find the rule row. requestAnimationFrame lines up after the
  // commit; one more frame is enough in practice for first mount.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const node = document.getElementById(`rule-row-${ruleId}`)
      if (!node) return
      node.scrollIntoView({ behavior: 'smooth', block: 'center' })
      const ringClasses = [
        'ring-2',
        'ring-violet-400',
        'ring-offset-2',
        'ring-offset-white',
        'dark:ring-offset-zinc-900',
      ]
      node.classList.add(...ringClasses)
      setTimeout(() => node.classList.remove(...ringClasses), 1500)
    })
  })
}

// ─── Inline per-field badge ───────────────────────────────────────────────

interface BindingIndicatorProps {
  element: LayoutElement
  target: BindingTarget
  className?: string
}

/**
 * Small violet chain-link badge. Renders nothing unless at least one
 * enabled rule writes to `target`. Click → scroll + flash the rule card.
 */
export function BindingIndicator({
  element,
  target,
  className,
}: BindingIndicatorProps) {
  const hits = rulesTargeting(element, target)
  if (hits.length === 0) return null

  const winner = hits[hits.length - 1]
  const label = BINDING_TARGETS[target].label
  const title =
    hits.length === 1
      ? `${label} is driven by rule #${winner.index + 1}. Click to jump.`
      : `${label} is driven by ${hits.length} rules — #${winner.index + 1} wins. Click to jump.`

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        focusRule(winner.rule.id)
      }}
      className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 transition-colors hover:bg-violet-200 dark:bg-violet-900/50 dark:text-violet-200 dark:hover:bg-violet-900 ${className ?? ''}`}
      title={title}
      aria-label={title}
    >
      {/* chain-link glyph → reads as "bound / linked" at this size */}
      <svg
        width="9"
        height="9"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </button>
  )
}

// ─── Panel-top rollup ─────────────────────────────────────────────────────

interface BindingIndicatorSummaryProps {
  element: LayoutElement
  className?: string
}

/**
 * Strip of chips at the top of the Props panel: "X is driven by rule #1",
 * "Fill color is driven by rule #3", "Visibility is controlled by rule #2".
 *
 * Renders null when the element has no active rules — zero visual noise
 * on the common case.
 */
export function BindingIndicatorSummary({
  element,
  className,
}: BindingIndicatorSummaryProps) {
  const rules = element.behaviour?.rules ?? []
  if (rules.length === 0) return null

  // Build one chip per active rule, labelled by what it does.
  const chips: Array<{ ruleId: string; index: number; label: string }> = []
  rules.forEach((rule, index) => {
    if (rule.enabled === false) return
    const base = `#${index + 1}`
    if (rule.action.kind === 'hide') {
      chips.push({ ruleId: rule.id, index, label: `${base} · Hide` })
    } else if (rule.action.kind === 'show') {
      chips.push({ ruleId: rule.id, index, label: `${base} · Show` })
    } else {
      const label = BINDING_TARGETS[rule.action.target]?.label ?? rule.action.target
      chips.push({ ruleId: rule.id, index, label: `${base} · ${label}` })
    }
  })

  if (chips.length === 0) return null

  return (
    <div
      className={`flex flex-wrap items-center gap-1 rounded-md border border-violet-200 bg-violet-50/60 px-2 py-1.5 text-[10px] dark:border-violet-900 dark:bg-violet-950/30 ${className ?? ''}`}
    >
      <span className="font-medium text-violet-700 dark:text-violet-200">
        Rules drive:
      </span>
      {chips.map((c) => (
        <button
          key={c.ruleId}
          type="button"
          onClick={() => focusRule(c.ruleId)}
          className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-white px-1.5 py-0.5 text-[10px] text-violet-800 hover:border-violet-500 hover:bg-violet-100 dark:border-violet-700 dark:bg-zinc-900 dark:text-violet-200 dark:hover:bg-zinc-800"
          title={`Jump to rule ${c.index + 1}`}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}
