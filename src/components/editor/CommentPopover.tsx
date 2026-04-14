import { useState } from 'react'
import type { ElementComment } from '../../types/layout'

/** Popover for viewing/adding comments on an element. */
export function CommentPopover({
  comments,
  onAdd,
  onResolve,
  onDelete,
  onClose,
}: {
  comments: ElementComment[]
  onAdd: (text: string) => void
  onResolve: (commentId: string) => void
  onDelete: (commentId: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')

  const submit = () => {
    const t = text.trim()
    if (!t) return
    onAdd(t)
    setText('')
  }

  return (
    <div
      className="fixed z-[10060] w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-600 dark:bg-zinc-900"
      data-agreemint-skip-canvas-inline-commit
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
          Comments ({comments.length})
        </h3>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      {comments.length > 0 && (
        <ul className="mb-2 flex max-h-40 flex-col gap-1.5 overflow-y-auto">
          {comments.map((c) => (
            <li
              key={c.id}
              className={`rounded border p-2 text-[11px] ${
                c.resolved
                  ? 'border-zinc-100 bg-zinc-50 text-zinc-400 line-through dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-500'
                  : 'border-zinc-200 bg-white text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
              }`}
            >
              <div className="flex items-start justify-between gap-1">
                <div>
                  <span className="font-medium">{c.author}</span>
                  <span className="ml-1 text-[9px] text-zinc-400">
                    {new Date(c.createdAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="flex gap-0.5">
                  {!c.resolved && (
                    <button
                      type="button"
                      className="rounded px-1 py-0.5 text-[9px] text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                      title="Resolve"
                      onClick={() => onResolve(c.id)}
                    >
                      ✓
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded px-1 py-0.5 text-[9px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30"
                    title="Delete"
                    onClick={() => onDelete(c.id)}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <p className="mt-0.5">{c.text}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-1">
        <input
          type="text"
          className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-[11px] dark:border-zinc-600 dark:bg-zinc-800"
          placeholder="Add a comment…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <button
          type="button"
          className="shrink-0 rounded bg-violet-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-violet-700 disabled:opacity-40"
          disabled={!text.trim()}
          onClick={submit}
        >
          Add
        </button>
      </div>
    </div>
  )
}
