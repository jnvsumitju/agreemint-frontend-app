import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../../stores/editorStore'
import { useAuthStore } from '../../stores/authStore'

/**
 * Styled in-app dialog for adding a comment to an element. Replaces the
 * previous {@link window.prompt} flow which produced an ugly browser-
 * native "localhost:5173 says" pop-up that designers (rightly) found
 * jarring.
 *
 * Triggered by setting {@code commentTargetElementId} in the editor
 * store — both the right-click "Add comment" menu item and the
 * canvas-side comment-icon click route through {@code openAddCommentModal}.
 *
 * Conventions:
 *   - Esc to dismiss, ⌘/Ctrl+Enter to submit
 *   - Submit button disabled while the textarea is empty/whitespace
 *   - Auto-focuses the textarea on open
 */
export function AddCommentModal() {
  const targetElementId = useEditorStore((s) => s.commentTargetElementId)
  const close = useEditorStore((s) => s.closeAddCommentModal)
  const addComment = useEditorStore((s) => s.addComment)
  const authUserName = useAuthStore((s) => s.user?.name ?? 'User')

  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    if (targetElementId) {
      setValue('')
      queueMicrotask(() => textareaRef.current?.focus())
    }
  }, [targetElementId])

  if (!targetElementId) return null

  const handleSubmit = () => {
    const text = value.trim()
    if (!text) return
    addComment(targetElementId, text, authUserName)
    close()
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-comment-title"
      onClick={close}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="add-comment-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Add a comment
            </h2>
            <p className="mt-0.5 text-[12px] leading-snug text-zinc-500 dark:text-zinc-400">
              Your note attaches to this element. Other collaborators see it in the Comments panel.
            </p>
          </div>
        </div>
        <textarea
          ref={textareaRef}
          rows={4}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Write your comment…"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              close()
              return
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              handleSubmit()
            }
          }}
          className="w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
        <div className="mt-4 flex items-center justify-between">
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">⌘/Ctrl+Enter to post</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!value.trim()}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-opacity hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add comment
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
