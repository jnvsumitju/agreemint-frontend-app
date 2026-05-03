/**
 * Element-level behavior editor. In v2 this is a thin shell around the
 * new unified {@link RulesEditor} — the old bespoke Visibility /
 * Color / Dynamic-size sections are gone, replaced by a single sentence-
 * shaped rules list.
 *
 * What lives here (not yet rule-shaped):
 *   - Text overflow mode (clip / ellipsis / shrinkToFit + min font size)
 *
 * The Lock toggle is owned by {@code BehaviourBody} (one tab up) so we
 * don't duplicate it here.
 *
 * Legacy behavior fields (visibilityRules, colorRules, size.*, imageSrcExpr)
 * are still readable — {@code legacyToRules} converts them on the fly so
 * old templates render identically. On the first save of any element, the
 * new editor writes `rules[]` and drops the legacy fields.
 */
import type { LayoutElement } from '../../types/layout'
import type { ElementBehaviour } from '../../types/layoutBehaviour'
import { RulesEditor } from './RulesEditor'

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
  const fid = (...parts: (string | number)[]) => `ag-eb-${el.id}-${parts.join('-')}`

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

  return (
    <div className="flex flex-col gap-3">
      <RulesEditor
        element={el}
        variables={variableKeyOptions}
        onBehaviourChange={setBehaviour}
      />

      {/* Text overflow — applies to text-ish elements only. Not yet a rule
          target because its semantics (auto-shrink with layout feedback)
          don't fit the "set <property>" shape. */}
      {(el.type === 'TEXT' || el.type === 'HEADER' || el.type === 'FOOTER') && (
        <label className="flex flex-col gap-1 rounded-md border border-zinc-200 bg-white/80 p-2 text-[11px] dark:border-zinc-700 dark:bg-zinc-900/50">
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
                  ? {
                      mode: v as 'clip' | 'ellipsis' | 'shrinkToFit',
                      minFontSize: b.textOverflow?.minFontSize,
                    }
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

      {/* Clear all — same spirit as the old editor's footer link. */}
      {Object.keys(b).length > 0 && (
        <button
          type="button"
          className="self-end text-[10px] text-zinc-400 hover:text-red-500"
          onClick={() => setBehaviour(undefined)}
        >
          Clear all behavior
        </button>
      )}
    </div>
  )
}
