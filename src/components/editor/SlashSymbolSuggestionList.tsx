import { useMemo } from 'react'
import type { SuggestionProps } from '@tiptap/suggestion'

export type SlashSymbolItem = {
  /** Stable id used as React key + lookup. */
  id: string
  /** The Unicode glyph that gets inserted at the cursor on selection. */
  char: string
  /** Human-readable name shown as the hover tooltip (e.g. "Pi"). */
  label: string
  /** Bucket the glyph belongs to (e.g. "Math · Greek" or "Emoji · Smileys"). */
  category: string
  /** When true the item lives in the math catalog — drives grid column count. */
  isMath: boolean
}

/**
 * Suggestion popup for the slash menu — same visual language as the
 * SymbolPickerPopover (categorised grid of glyphs with hover tooltips)
 * so authors get a consistent picker UI no matter which entry point
 * they used. The TipTap suggestion plugin pre-filters {@code items}
 * based on what the author typed after {@code /}; we just group the
 * matches by category and render them.
 *
 * <p>No separate search input — the document itself is the search field
 * (whatever the user types after {@code /} flows back through the
 * plugin's {@code items()} filter). No close button — Escape and
 * outside-clicks are handled by tippy / the suggestion plugin.
 */
export function SlashSymbolSuggestionList(
  props: SuggestionProps<SlashSymbolItem, SlashSymbolItem>,
) {
  const { items, command } = props
  const grouped = useMemo(() => groupItemsByCategory(items), [items])
  // Math glyphs use 8 cols (narrower characters); emoji uses 7 cols
  // (wider). When a section mixes — never happens with the current
  // catalog but defensively — we fall back to math's 8 cols.
  return (
    <div
      data-agreemint-skip-canvas-inline-commit
      // Explicit text colour matters here — Tippy's default theme sets
      // {@code color: #fff} on {@code .tippy-box}, which would cascade
      // into the glyph buttons (they have no explicit colour of their
      // own) and make every symbol invisibly white-on-white. Headers
      // and the hint text already set their own colour, so only the
      // grid buttons were affected before this fix.
      className="flex w-[300px] flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-2 text-zinc-800 shadow-xl dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
        Insert symbol — type after{' '}
        <kbd className="rounded bg-zinc-100 px-0.5 font-mono dark:bg-zinc-800">/</kbd>{' '}
        to filter
      </p>
      <div className="max-h-[280px] overflow-y-auto pr-1">
        {grouped.length === 0 ? (
          <p className="px-1 py-2 text-center text-[10px] text-zinc-500 dark:text-zinc-400">
            No matching symbols
          </p>
        ) : (
          grouped.map(({ category, items, isMath }) => (
            <section key={category} className="mb-2">
              <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {category}
              </p>
              <div className={`grid gap-0.5 ${isMath ? 'grid-cols-8' : 'grid-cols-7'}`}>
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    title={item.label}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => command(item)}
                    className="flex aspect-square items-center justify-center rounded border border-transparent text-base transition-colors hover:border-violet-300 hover:bg-violet-50 dark:hover:border-violet-500 dark:hover:bg-violet-950/40"
                  >
                    <span aria-hidden className="leading-none">{item.char}</span>
                    <span className="sr-only">{item.label}</span>
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}

function groupItemsByCategory(items: SlashSymbolItem[]): Array<{
  category: string
  items: SlashSymbolItem[]
  isMath: boolean
}> {
  // Insertion-ordered map so categories appear in the order the
  // suggestion plugin returned them. Math items naturally lead since
  // the slash plugin concatenates math then emoji.
  const map = new Map<string, { items: SlashSymbolItem[]; isMath: boolean }>()
  for (const item of items) {
    const existing = map.get(item.category)
    if (existing) {
      existing.items.push(item)
    } else {
      map.set(item.category, { items: [item], isMath: item.isMath })
    }
  }
  return Array.from(map.entries()).map(([category, value]) => ({
    category,
    items: value.items,
    isMath: value.isMath,
  }))
}
