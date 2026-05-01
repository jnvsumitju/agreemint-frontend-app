import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { VariableChipInfo } from './layoutBehaviourResolve'

function LayoutVariableChip(props: NodeViewProps) {
  const name = String(props.node.attrs.name ?? '')
  const storage = props.editor.storage.variableSuggestStorage
  const preview = storage?.previewValues?.[name] ?? ''
  const surface =
    typeof storage?.resolveSurfaceLabel === 'function' ? storage.resolveSurfaceLabel(name) : ''
  const display = surface.trim() ? surface : `{{${name}}}`
  const detailEnabled = !!storage?.chipDetailEnabled && typeof storage?.resolveChipInfo === 'function'

  // Inline marks (bold / italic / underline / strike) apply to the chip so a
  // selection that covered the var when the author toggled the mark shows
  // up on the chip too. The Node spec's `marks: '_'` lets the atom carry
  // these; we read them off `props.node.marks` and emit matching CSS.
  let markBold = false
  let markItalic = false
  let markUnderline = false
  let markStrike = false
  let markTextColor: string | undefined
  let markHighlight: string | undefined
  for (const m of props.node.marks) {
    switch (m.type.name) {
      case 'bold':
        markBold = true
        break
      case 'italic':
        markItalic = true
        break
      case 'underline':
        markUnderline = true
        break
      case 'strike':
        markStrike = true
        break
      case 'textStyle':
        if (typeof m.attrs.color === 'string' && m.attrs.color) markTextColor = m.attrs.color
        break
      case 'highlight':
        if (typeof m.attrs.color === 'string' && m.attrs.color) markHighlight = m.attrs.color
        break
    }
  }
  const markDeco: string[] = []
  if (markUnderline) markDeco.push('underline')
  if (markStrike) markDeco.push('line-through')
  const chipMarkStyle: React.CSSProperties = {
    fontWeight: markBold ? 700 : undefined,
    fontStyle: markItalic ? 'italic' : undefined,
    textDecoration: markDeco.length ? markDeco.join(' ') : undefined,
    color: markTextColor,
    backgroundColor: markHighlight,
  }

  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const bumpPosition = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const maxLeft = Math.max(8, window.innerWidth - 288 - 8)
    setPos({ top: r.bottom + 6, left: Math.min(Math.max(8, r.left), maxLeft) })
  }, [])

  useLayoutEffect(() => {
    if (!open || !detailEnabled) {
      if (!open) setPos(null)
      return
    }
    bumpPosition()
    window.addEventListener('scroll', bumpPosition, true)
    return () => window.removeEventListener('scroll', bumpPosition, true)
  }, [open, detailEnabled, bumpPosition, name])

  useEffect(() => {
    if (!open || !detailEnabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, detailEnabled])

  useEffect(() => {
    if (!open || !detailEnabled) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as unknown as globalThis.Node
      if (wrapRef.current?.contains(t)) return
      if (popRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [open, detailEnabled])

  const chipInfo: VariableChipInfo | null =
    open && detailEnabled && storage?.resolveChipInfo ? storage.resolveChipInfo(name) : null

  // Right-click opens the details popover. Left-click is intentionally NOT
  // hijacked any more — it falls through to ProseMirror so the chip becomes
  // selected (a NodeSelection of the atom), which lets the format bar or
  // keyboard shortcut toggle inline marks on the selected chip. Previously
  // the onClick here called stopPropagation + opened the popover, which
  // meant a user had no way to click a chip and then press Cmd-B / etc.
  const onChipContextMenu = (e: React.MouseEvent) => {
    if (!detailEnabled) return
    e.preventDefault()
    e.stopPropagation()
    setOpen((v) => !v)
  }

  const popover =
    open && chipInfo && pos && detailEnabled
      ? createPortal(
          <div
            ref={popRef}
            data-agreemint-skip-canvas-inline-commit
            className="fixed z-[99999] max-w-[min(calc(100vw-16px),18rem)] rounded-lg border border-zinc-200 bg-white p-2.5 text-[11px] shadow-xl dark:border-zinc-600 dark:bg-zinc-900"
            style={{ top: pos.top, left: pos.left }}
            role="dialog"
            aria-label="Variable details"
          >
            <div className="border-b border-zinc-100 pb-1.5 font-mono text-xs font-semibold text-violet-900 dark:border-zinc-700 dark:text-violet-200">
              {chipInfo.token}
            </div>
            <p className="mt-1.5 leading-snug text-zinc-700 dark:text-zinc-200">{chipInfo.scopeLine}</p>
            {chipInfo.description ? (
              <p className="mt-1.5 whitespace-pre-wrap leading-snug text-zinc-600 dark:text-zinc-300">
                {chipInfo.description}
              </p>
            ) : null}
            {chipInfo.previewLine ? (
              <p className="mt-1.5 max-h-28 overflow-y-auto break-all font-mono text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
                {chipInfo.previewLine}
              </p>
            ) : null}
            <p className="mt-2 text-[10px] text-zinc-400 dark:text-zinc-500">
              Click away or press Escape to dismiss.
            </p>
          </div>,
          document.body
        )
      : null

  return (
    <NodeViewWrapper as="span" className="am-inline-var-root inline" contentEditable={false}>
      <span
        ref={wrapRef}
        data-am-var={name}
        contentEditable={false}
        role={detailEnabled ? 'button' : undefined}
        tabIndex={detailEnabled ? 0 : undefined}
        aria-expanded={detailEnabled ? open : undefined}
        aria-haspopup={detailEnabled ? 'dialog' : undefined}
        onContextMenu={onChipContextMenu}
        // Keyboard shortcut preserved for accessibility: when the chip has
        // keyboard focus, Enter or Space opens the details popover (the
        // equivalent of right-click).
        onKeyDown={(e) => {
          if (!detailEnabled) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen((v) => !v)
          }
        }}
        // `font-medium` removed intentionally: the chip inherits the
        // element-level `fontWeight` / `fontStyle` / `textDecoration` from
        // the containing textbox wrapper in edit mode, so a bold textbox
        // renders bold chips (matching the view-mode preview). A
        // Tailwind weight class on the chip would lock it to 500 and
        // defeat the inheritance.
        className={`am-inline-var inline rounded bg-violet-100 px-1 py-px text-[0.92em] text-violet-900 ring-1 ring-violet-300/80 dark:bg-violet-950/70 dark:text-violet-100 dark:ring-violet-700/80 ${
          detailEnabled
            ? 'cursor-pointer select-none hover:ring-violet-500/90 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:hover:ring-violet-500/80'
            : 'cursor-default select-none'
        }`}
        style={chipMarkStyle}
        title={
          (() => {
            const parts: string[] = []
            if (name) parts.push(`Token: {{${name}}}`)
            if (preview.trim()) parts.push(`Variables tab preview: ${preview}`)
            if (detailEnabled) parts.push('Click to select · right-click for scope + description · Cmd/Ctrl+B to style.')
            return parts.length ? parts.join('\n') : 'Merge field'
          })()
        }
      >
        {display}
      </span>
      {popover}
    </NodeViewWrapper>
  )
}

export const LayoutVariable = Node.create({
  name: 'layoutVariable',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  // Allow inline marks on the atom. Without this, applying bold/italic/
  // underline/strike to a selection that covers a variable chip would
  // only mark the surrounding text — the chip would stay unstyled.
  // With `marks: '_'` (ProseMirror "any mark") TipTap's `toggleMark`
  // applies to the atom too, and the NodeView reads `node.marks` to
  // render the chip with the matching typography.
  marks: '_',
  addAttributes() {
    return {
      name: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-am-var') ?? '',
        renderHTML: (attrs) => (attrs.name ? { 'data-am-var': attrs.name } : {}),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-am-var]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-am-var': HTMLAttributes.name,
        class: 'am-inline-var',
        contenteditable: 'false',
      }),
      0,
    ]
  },
  renderText({ node }) {
    return `{{${node.attrs.name}}}`
  },
  addNodeView() {
    return ReactNodeViewRenderer(LayoutVariableChip)
  },
})
