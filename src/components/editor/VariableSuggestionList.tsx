import type { SuggestionProps } from '@tiptap/suggestion'

export type VariableSuggestItem = { id: string; label: string }

export function VariableSuggestionList(props: SuggestionProps<VariableSuggestItem, VariableSuggestItem>) {
  const { items, command } = props
  return (
    <div
      data-agreemint-skip-canvas-inline-commit
      className="rounded-md border border-zinc-200 bg-white py-1 text-xs shadow-xl dark:border-zinc-600 dark:bg-zinc-900"
    >
      <p className="border-b border-zinc-100 px-2 py-1 text-[10px] font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        Insert field — <kbd className="rounded bg-zinc-100 px-0.5 font-mono dark:bg-zinc-800">@</kbd> to open
      </p>
      <ul className="max-h-52 overflow-y-auto">
        {items.length === 0 ? (
          <li className="px-2 py-1.5 text-zinc-400">No matching fields</li>
        ) : (
          items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="w-full px-2 py-1.5 text-left hover:bg-violet-50 dark:hover:bg-violet-950/50"
                onClick={() => command(item)}
              >
                <span className="block font-medium text-zinc-800 dark:text-zinc-100">{item.label}</span>
                {item.label !== item.id ? (
                  <span className="mt-0.5 block font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                    {'{{'}
                    {item.id}
                    {'}}'}
                  </span>
                ) : null}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
