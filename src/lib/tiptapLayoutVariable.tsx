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
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if (popRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [open, detailEnabled])

  const chipInfo: VariableChipInfo | null =
    open && detailEnabled && storage?.resolveChipInfo ? storage.resolveChipInfo(name) : null

  const onChipClick = (e: React.MouseEvent) => {
    if (!detailEnabled) return
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
        onClick={onChipClick}
        onKeyDown={(e) => {
          if (!detailEnabled) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen((v) => !v)
          }
        }}
        className={`am-inline-var inline rounded bg-violet-100 px-1 py-px text-[0.92em] font-medium text-violet-900 ring-1 ring-violet-300/80 dark:bg-violet-950/70 dark:text-violet-100 dark:ring-violet-700/80 ${
          detailEnabled
            ? 'cursor-pointer select-none hover:ring-violet-500/90 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:hover:ring-violet-500/80'
            : 'cursor-default select-none'
        }`}
        title={
          (() => {
            const parts: string[] = []
            if (name) parts.push(`Token: {{${name}}}`)
            if (preview.trim()) parts.push(`Variables tab preview: ${preview}`)
            if (detailEnabled) parts.push('Click for scope and description.')
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
