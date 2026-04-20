import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import { sanitizeLinkHref } from '../../lib/richContent'

/**
 * Normalise user input into a safe link URL:
 *   • `example.com/path` → `https://example.com/path`
 *   • `user@example.com` → `mailto:user@example.com`
 *   • anything that fails the protocol safe-list after normalisation is rejected
 *
 * (Variables in the link URL are out of scope by design — merge fields are
 *  inserted inline via `@` in the editor itself, not through the link popover.)
 */
function normaliseUserInputToHref(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const withProto = /^(https?:|mailto:|tel:)/i.test(trimmed)
    ? trimmed
    : trimmed.includes('@') && !/\s/.test(trimmed) && !trimmed.startsWith('//')
      ? `mailto:${trimmed}`
      : `https://${trimmed.replace(/^\/+/, '')}`
  return sanitizeLinkHref(withProto)
}

/** Returns the current selection's link href, or '' if the selection has no link mark. */
function readExistingHref(editor: Editor): string {
  const { state } = editor
  const { from, to } = state.selection
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

/**
 * Returns the plain-text content covered by the current selection, or —
 * if the cursor is empty AND sits inside an existing link — the full text
 * of the link mark's run (so opening the popover on an existing link
 * pre-fills the "Text to display" field with the link's visible label).
 */
function readSelectedText(editor: Editor): string {
  const { state } = editor
  const { from, to } = state.selection
  if (from !== to) {
    // Range selection — read text covered.
    return state.doc.textBetween(from, to, '\n', '\n')
  }
  // Empty cursor — if sitting inside a link, extend across the whole mark
  // range and read that. Otherwise nothing to pre-fill.
  const $from = state.selection.$from
  const linkMark = $from.marks().find((m) => m.type.name === 'link')
  if (!linkMark) return ''
  // Walk left and right from the cursor while the link mark remains active.
  const linkType = linkMark.type
  let start = $from.pos
  let end = $from.pos
  const parent = $from.parent
  const parentStart = $from.start()
  parent.descendants((node, offset) => {
    if (!node.isText) return
    const absStart = parentStart + offset
    const absEnd = absStart + node.nodeSize
    if (linkType.isInSet(node.marks)) {
      start = Math.min(start, absStart)
      end = Math.max(end, absEnd)
    }
  })
  if (end <= start) return ''
  return state.doc.textBetween(start, end, '\n', '\n')
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
 * Two input fields, Google-Docs style:
 *   1. **Text to display** — pre-filled with whatever is currently selected
 *      (or the full text of an existing link if the cursor is inside one).
 *      Editing it REPLACES the target range with the new text when applied.
 *   2. **Link URL** — empty for a new link, pre-filled for an existing one.
 *      Validated against a protocol safe-list (`http`, `https`, `mailto`,
 *      `tel`); bare domains auto-prepend `https://`; bare email-likes
 *      auto-prepend `mailto:`.
 *
 * `Enter` applies, `Esc` / click-outside cancels, Remove button appears
 * only when editing an existing link.
 */
export function LinkEditorPopover({ editor, anchorRect, onClose }: LinkEditorPopoverProps) {
  // Cache the selection state AS IT IS when the popover opens. We capture
  // the from/to positions too — when the user focuses one of our input
  // fields, DOM focus leaves the editor and the browser hides the visible
  // blue highlight. ProseMirror normally keeps the logical selection
  // around in `editor.state`, but in some paths (autofocus into the input,
  // pointer down elsewhere, etc.) the range collapses to a cursor. If we
  // called `setLink` at apply time against a collapsed cursor, it would
  // silently no-op. Explicitly restoring the captured from/to before
  // every apply branch makes the link always land on the right range.
  const initial = useMemo(() => {
    const { from, to } = editor.state.selection
    return {
      hadLink: hasLinkAtSelection(editor),
      href: readExistingHref(editor),
      text: readSelectedText(editor),
      from,
      to,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [text, setText] = useState(initial.text)
  const [href, setHref] = useState(initial.href)
  const [error, setError] = useState<string | null>(null)
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    top: 0,
    left: 0,
    visibility: 'hidden',
  })
  const rootRef = useRef<HTMLDivElement | null>(null)
  const urlInputRef = useRef<HTMLInputElement | null>(null)
  const textInputRef = useRef<HTMLInputElement | null>(null)

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

  // Autofocus strategy:
  //   • If there's already text selected (so "Text to display" is pre-filled),
  //     jump straight to the URL field — that's what the user still needs to
  //     fill in. Matches Google Docs.
  //   • Otherwise (empty selection, no pre-existing link), focus the Text
  //     field so the user can type the label first.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const target = initial.text || initial.hadLink ? urlInputRef.current : textInputRef.current
      target?.focus()
      target?.select()
    }, 0)
    return () => window.clearTimeout(t)
  }, [initial.text, initial.hadLink])

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
      setError('Enter a valid URL (https://…, mailto:…, tel:…)')
      urlInputRef.current?.focus()
      return
    }
    const newText = text.trim()
    if (!newText) {
      setError('Text to display cannot be empty')
      textInputRef.current?.focus()
      return
    }

    const linkAttrs = { href: normalised, target: '_blank', rel: 'noopener noreferrer' }
    const hadRange = initial.from !== initial.to

    // Use a direct ProseMirror transaction via `.command(({ tr, state }))`
    // rather than TipTap's `.setLink()` helper. Rationale:
    //   • `.setLink()` internally funnels through `isAllowedUri` and
    //     `setMark` which, combined with the focus/selection round-trip
    //     the popover does, has been observed to silently no-op in
    //     borderline cases (selection collapsed during DOM focus shift,
    //     validator config mismatch, etc.). The user's symptom was
    //     "link apply seems to succeed but the text never renders as a
    //     link" — the mark never reached the doc.
    //   • A direct `tr.addMark(from, to, schema.marks.link.create(attrs))`
    //     goes straight to ProseMirror. If the range is valid and the
    //     schema has the link mark (it does — the Link extension is
    //     registered), the mark lands. No chain surprises.
    //   • URL safety is already enforced client-side by
    //     `normaliseUserInputToHref` above (and server-side by
    //     `sanitizePdfLinkHref` when rendering). TipTap's validators
    //     are redundant here.
    if (initial.hadLink) {
      // Edit-existing-link: expand to the whole link mark range, then
      // replace it with the new linked text.
      editor
        .chain()
        .focus()
        .setTextSelection({ from: initial.from, to: initial.to })
        .extendMarkRange('link')
        .command(({ tr, state: s }) => {
          const { from, to } = s.selection
          const linkMark = s.schema.marks.link.create(linkAttrs)
          tr.replaceRangeWith(from, to, s.schema.text(newText, [linkMark]))
          return true
        })
        .run()
    } else if (hadRange && newText === initial.text) {
      // Range with unchanged text: add the link mark to the range.
      // Preserves any bold/italic/color marks already on those chars.
      editor
        .chain()
        .focus()
        .setTextSelection({ from: initial.from, to: initial.to })
        .command(({ tr, state: s }) => {
          const linkMark = s.schema.marks.link.create(linkAttrs)
          tr.addMark(initial.from, initial.to, linkMark)
          return true
        })
        .run()
    } else if (hadRange) {
      // Range with edited text: replace the range with the new linked
      // text. Original text's other marks are dropped — fair because
      // the user explicitly re-typed the label.
      editor
        .chain()
        .focus()
        .setTextSelection({ from: initial.from, to: initial.to })
        .command(({ tr, state: s }) => {
          const linkMark = s.schema.marks.link.create(linkAttrs)
          tr.replaceRangeWith(initial.from, initial.to, s.schema.text(newText, [linkMark]))
          return true
        })
        .run()
    } else {
      // Empty cursor: insert the new linked text at the caret.
      editor
        .chain()
        .focus()
        .setTextSelection({ from: initial.from, to: initial.to })
        .command(({ tr, state: s }) => {
          const linkMark = s.schema.marks.link.create(linkAttrs)
          tr.insert(initial.from, s.schema.text(newText, [linkMark]))
          return true
        })
        .run()
    }
    onClose()
  }

  const remove = () => {
    // Restore the captured selection first — same reasoning as `apply`:
    // DOM focus may have drifted into the popover input, collapsing the
    // PM selection. `extendMarkRange('link')` needs at least a cursor
    // that still sits inside the link mark to work correctly.
    editor
      .chain()
      .focus()
      .setTextSelection({ from: initial.from, to: initial.to })
      .extendMarkRange('link')
      .unsetLink()
      .run()
    onClose()
  }

  const title = initial.hadLink ? 'Edit link' : 'Insert link'

  return createPortal(
    <div
      ref={rootRef}
      style={style}
      className="w-[340px] rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-600 dark:bg-zinc-800"
      onMouseDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={title}
    >
      <div className="mb-2.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200">{title}</div>

      {/* Text-to-display input */}
      <label className="block">
        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Text to display
        </span>
        <input
          ref={textInputRef}
          type="text"
          value={text}
          placeholder="Link label (e.g. Download contract)"
          spellCheck={false}
          autoComplete="off"
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-violet-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          onChange={(e) => {
            setText(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              // Move focus down to the URL field on Enter if empty,
              // otherwise apply.
              if (!href.trim()) urlInputRef.current?.focus()
              else apply()
            }
          }}
        />
      </label>

      {/* URL input */}
      <label className="mt-2 block">
        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Link URL
        </span>
        <input
          ref={urlInputRef}
          type="url"
          value={href}
          placeholder="https://example.com"
          spellCheck={false}
          autoComplete="off"
          inputMode="url"
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-violet-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
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
      </label>

      {error ? (
        <div className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{error}</div>
      ) : (
        <div className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          Accepts https, mailto, and tel URLs.
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        {initial.hadLink ? (
          <button
            type="button"
            onClick={remove}
            className="rounded border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            Remove link
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
            {initial.hadLink ? 'Update' : 'Apply'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
