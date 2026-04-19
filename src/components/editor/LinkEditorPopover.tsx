import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import { sanitizeLinkHref } from '../../lib/richContent'

/**
 * Normalise user input into a safe link URL:
 *   • `example.com/path` → `https://example.com/path`
 *   • `user@example.com` → `mailto:user@example.com`
 *   • `{{orderUrl}}` passes through unchanged (variable-only URLs are
 *     resolved at render / PDF time)
 *   • anything that fails the protocol safe-list after normalisation is rejected
 */
function normaliseUserInputToHref(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (/^\{\{[^}]+\}\}$/.test(trimmed)) return sanitizeLinkHref(trimmed)
  const withProto = /^(https?:|mailto:|tel:)/i.test(trimmed)
    ? trimmed
    : trimmed.includes('@') && !/\s/.test(trimmed) && !trimmed.startsWith('//')
      ? `mailto:${trimmed}`
      : `https://${trimmed.replace(/^\/+/, '')}`
  return sanitizeLinkHref(withProto)
}

/** Returns the current selection's link href, or empty string if the selection has no link mark. */
function readExistingHref(editor: Editor): string {
  const { state } = editor
  const { from, to } = state.selection
  // Walk the selection for the first link mark; if the cursor is empty, read the mark at cursor.
  if (from === to) {
    const marks = state.selection.$from.marks()
    for (const m of marks) {
      if (m.type.name === 'link' && typeof m.attrs.href === 'string') return m.attrs.href
    }
    return ''
  }
  let href = ''
  state.doc.nodesBetween(from, to, (node) => {
    if (href) return false
    for (const m of node.marks) {
      if (m.type.name === 'link' && typeof m.attrs.href === 'string') {
        href = m.attrs.href
        return false
      }
    }
    return true
  })
  return href
}

/** True when the cursor/selection already carries a link mark. */
function hasLinkAtSelection(editor: Editor): boolean {
  return !!readExistingHref(editor)
}

export interface LinkEditorPopoverProps {
  /** The editor the popover is operating on. */
  editor: Editor
  /** Screen-space anchor rect to position the popover against. Usually the toolbar button. */
  anchorRect: DOMRect
  onClose: () => void
}

/**
 * Anchored floating popover for inserting / editing / removing a hyperlink
 * on the current TipTap selection.
 *
 * Behaviours:
 *   • Opens pre-filled with the existing link URL if one is under the cursor.
 *   • `Enter` applies; `Escape` / click-outside cancels.
 *   • "Remove" button appears only when an existing link is present.
 *   • Input normalises bare domains to `https://…` and validates against the
 *     safe-protocol safe-list before applying.
 *   • If the user has no text selected AND isn't inside an existing link, the
 *     typed URL is inserted as linkified text (so Cmd+K with no selection
 *     becomes a "type URL → inserts as link" flow).
 */
export function LinkEditorPopover({ editor, anchorRect, onClose }: LinkEditorPopoverProps) {
  const [href, setHref] = useState(() => readExistingHref(editor))
  const [error, setError] = useState<string | null>(null)
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    top: 0,
    left: 0,
    visibility: 'hidden',
  })
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const hadLinkAtOpen = useRef(hasLinkAtSelection(editor)).current

  // Position the popover just below the anchor, clamped to viewport.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    const gap = 6
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = anchorRect.left
    let top = anchorRect.bottom + gap
    if (left + rect.width > vw - 8) left = vw - rect.width - 8
    if (left < 8) left = 8
    if (top + rect.height > vh - 8) {
      // Not enough room below — flip above.
      top = anchorRect.top - rect.height - gap
    }
    if (top < 8) top = 8
    setStyle({ position: 'fixed', top, left, visibility: 'visible', zIndex: 1000 })
  }, [anchorRect])

  // Autofocus the input on open.
  useEffect(() => {
    const t = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(t)
  }, [])

  // Click-outside + Esc to cancel.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const root = rootRef.current
      if (!root) return
      if (e.target instanceof Node && root.contains(e.target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const apply = () => {
    const normalised = normaliseUserInputToHref(href)
    if (!normalised) {
      setError('Enter an http(s), mailto, tel, or {{variable}} link')
      return
    }
    const { state } = editor
    const selection = state.selection
    if (selection.empty && !hadLinkAtOpen) {
      // No selection AND no pre-existing link — insert the URL as linkified text.
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'text',
          text: normalised,
          marks: [
            {
              type: 'link',
              attrs: { href: normalised, target: '_blank', rel: 'noopener noreferrer' },
            },
          ],
        })
        .run()
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: normalised, target: '_blank', rel: 'noopener noreferrer' })
        .run()
    }
    onClose()
  }

  const remove = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    onClose()
  }

  return createPortal(
    <div
      ref={rootRef}
      style={style}
      className="w-[320px] rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-600 dark:bg-zinc-800"
      onMouseDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={hadLinkAtOpen ? 'Edit link' : 'Insert link'}
    >
      <div className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
        {hadLinkAtOpen ? 'Edit link' : 'Insert link'}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={href}
        placeholder="https://example.com"
        spellCheck={false}
        autoComplete="off"
        className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-violet-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
        onChange={(e) => {
          setHref(e.target.value)
          if (error) setError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            apply()
          }
        }}
      />
      {error ? (
        <div className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{error}</div>
      ) : (
        <div className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          Use <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-700">{'{{variable}}'}</code>{' '}
          to plug runtime values into the URL.
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        {hadLinkAtOpen ? (
          <button
            type="button"
            onClick={remove}
            className="rounded border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            Remove
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            className="rounded bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700"
          >
            {hadLinkAtOpen ? 'Update' : 'Apply'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
