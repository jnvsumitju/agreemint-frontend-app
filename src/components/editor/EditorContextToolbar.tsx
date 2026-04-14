/**
 * @deprecated This component has been superseded by FormatBar.tsx which now serves as
 * the universal context-sensitive toolbar (Row 2). This file is kept temporarily for
 * reference. All functionality including the rich-text help dialog, element-type
 * branching, focused-text-run formatting, and TipTap toolbar wiring has been migrated
 * to FormatBar.tsx. Safe to delete once the migration is validated.
 */
import type { ReactNode, RefObject } from 'react'
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { findElementByIdInDocumentDeep } from '../../lib/bandNestedLayout'
import { FONT_SIZE_MIN, FONT_SIZE_MAX } from '../../lib/editorConstants'
import { TOOLBAR_CHIP_CLASS } from './uiClasses'
import { richTextDebugLog } from '../../lib/richTextDebugLog'
import { useEditorStore } from '../../stores/editorStore'
import type { ElementStyle, LayoutElement } from '../../types/layout'
import { isRichTextElement } from '../../types/layout'
import { parseContentToRuns } from '../../lib/richContent'
import {
  patchTextRunColor,
  mergeElementStyle,
  omitStyleKey,
  patchTextRunFormat,
} from '../../lib/elementStyleHelpers'
import { TableContextToolbar } from './TableContextToolbar'
import { RichTextFormatToolbar } from './RichTextFormatToolbar'
import { RichTextTipTapToolbar } from './RichTextTipTapToolbar'
import { ColorToolbarSwatch } from './ColorPalettePopover'

const RICH_TEXT_CANVAS_HINT_LONG =
  'Double-click the text on the page to edit inline. While editing, use the top bar for bold, italic, underline, strikethrough, super/subscript, text color, and highlight. Press Escape to cancel or ⌘/Ctrl+Enter to finish.'

const RICH_TEXT_FIELD_SEGMENT_HINT_LONG =
  'A merge field is selected. Double-click the text to edit; bold, italic, and colors apply to text runs, not to merge fields.'

/** Which help copy to show when ⌘/Ctrl+Shift+H is pressed with a rich-text element in context. */
function richTextHelpVariantFromStore(): 'canvas' | 'merge-field' | null {
  const s = useEditorStore.getState()
  const ids = s.selectedIds
  if (ids.length !== 1) return null
  const el = findElementByIdInDocumentDeep(s.pages, ids[0])
  if (!el || !isRichTextElement(el)) return null
  if (s.canvasInlineEditId === el.id) return 'canvas'
  const idx = s.focusedTextRunIndex
  if (idx != null) {
    const runs = parseContentToRuns(el.content)
    const r = runs[idx]
    if (r?.type === 'var') return 'merge-field'
  }
  return 'canvas'
}

/**
 * ⌘/Ctrl+Shift+H only when focus is on the canvas, top header (incl. context toolbar), or the help dialog —
 * not in sidebars (aside), status bar (footer), or form fields.
 */
function isRichTextHelpShortcutFocusAllowed(): boolean {
  const ae = document.activeElement
  if (ae == null || ae === document.body || ae === document.documentElement) return true
  if (!(ae instanceof Element)) return false
  if (ae.closest('aside') || ae.closest('footer')) return false
  if (ae.closest('input, textarea, select')) return false
  if (ae.closest('[data-agreemint-rich-text-help-dialog]')) return true
  if (ae.closest('header') || ae.closest('[data-agreemint-canvas-root]')) return true
  return false
}

function TextElementChrome({
  el,
  updateElement,
}: {
  el: LayoutElement
  updateElement: (id: string, patch: Partial<LayoutElement>) => void
}) {
  if (!isRichTextElement(el)) return null
  const style = el.style ?? {}
  const align = style.align ?? 'left'
  const fs = Math.round(style.fontSize ?? 12)
  const patchStyle = (s: Partial<ElementStyle>) =>
    updateElement(el.id, { style: mergeElementStyle(style, s) })

  const chip = (active: boolean) =>
    `min-w-[1.5rem] rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors lg:min-w-[1.75rem] lg:px-2 lg:py-1 lg:text-xs ${
      active
        ? 'border-violet-600 bg-violet-100 text-violet-900 dark:border-violet-500 dark:bg-violet-950/60 dark:text-violet-100'
        : 'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700'
    }`

  return (
    <div
      className="flex flex-nowrap items-center gap-1 overflow-x-auto border-b border-zinc-200 bg-zinc-50/80 px-1 py-0.5 lg:gap-2 lg:py-1 dark:border-zinc-600 dark:bg-zinc-800/50"
      onMouseDownCapture={(e) => e.button === 0 && e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      role="group"
      aria-label={
        el.type === 'HEADER' ? 'Header block' : el.type === 'FOOTER' ? 'Footer block' : 'Text block'
      }
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Align
      </span>
      {(['left', 'center', 'right'] as const).map((a) => (
        <button
          key={a}
          type="button"
          title={`Align ${a}`}
          className={chip(align === a)}
          onMouseDown={(e) => {
            e.preventDefault()
            patchStyle({ align: a })
          }}
        >
          {a === 'left' ? '◀' : a === 'center' ? '◆' : '▶'}
        </button>
      ))}
      <span className="ml-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Size
      </span>
      <button
        type="button"
        title="Smaller font"
        className={chip(false)}
        onMouseDown={(e) => {
          e.preventDefault()
          patchStyle({ fontSize: Math.max(FONT_SIZE_MIN, fs - 1) })
        }}
      >
        −
      </button>
      <span className="min-w-[1.5rem] text-center text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
        {fs}
      </span>
      <button
        type="button"
        title="Larger font"
        className={chip(false)}
        onMouseDown={(e) => {
          e.preventDefault()
          patchStyle({ fontSize: Math.min(FONT_SIZE_MAX, fs + 1) })
        }}
      >
        +
      </button>
      <span className="ml-1 hidden h-4 w-px shrink-0 bg-zinc-300 dark:bg-zinc-600 sm:block" aria-hidden />
      <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Color
      </span>
      <ColorToolbarSwatch
        title="Text color"
        value={style.color}
        onChange={(v) => patchStyle({ color: v })}
        onClear={() => updateElement(el.id, { style: omitStyleKey(style, 'color') })}
      />
      <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Bg</span>
      <ColorToolbarSwatch
        title="Background color"
        value={style.backgroundColor}
        onChange={(v) => patchStyle({ backgroundColor: v })}
        onClear={() => updateElement(el.id, { style: omitStyleKey(style, 'backgroundColor') })}
      />
    </div>
  )
}

export function EditorContextToolbar({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  const [textHelpOpen, setTextHelpOpen] = useState(false)
  const [textHelpVariant, setTextHelpVariant] = useState<'canvas' | 'merge-field'>('canvas')

  const selectedIds = useEditorStore((s) => s.selectedIds)
  const pages = useEditorStore((s) => s.pages)
  const canvasInlineEditId = useEditorStore((s) => s.canvasInlineEditId)
  const focusedTextRunIndex = useEditorStore((s) => s.focusedTextRunIndex)
  const updateElement = useEditorStore((s) => s.updateElement)
  const inlineTipTapRaw = useEditorStore((s) => s.inlineTipTapEditor)
  const setInlineTipTapEditor = useEditorStore((s) => s.setInlineTipTapEditor)

  /** TipTap can destroy the instance in-place; Zustand still holds the same ref → clear so onReady can re-register. */
  useLayoutEffect(() => {
    const raw = inlineTipTapRaw
    if (!raw?.isDestroyed) return
    if (useEditorStore.getState().inlineTipTapEditor !== raw) return
    setInlineTipTapEditor(null)
  }, [inlineTipTapRaw, setInlineTipTapEditor])

  const tipTapToolbarEditor =
    inlineTipTapRaw && !inlineTipTapRaw.isDestroyed ? inlineTipTapRaw : null

  const onRichTextHelpShortcut = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'h' && e.key !== 'H') return
    if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return
    if (e.repeat) return
    if (!isRichTextHelpShortcutFocusAllowed()) return

    const variant = richTextHelpVariantFromStore()
    if (variant == null) return

    e.preventDefault()
    setTextHelpOpen((open) => {
      if (open) return false
      setTextHelpVariant(variant)
      return true
    })
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', onRichTextHelpShortcut, true)
    return () => window.removeEventListener('keydown', onRichTextHelpShortcut, true)
  }, [onRichTextHelpShortcut])

  useEffect(() => {
    if (!textHelpOpen) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setTextHelpOpen(false)
    }
    window.addEventListener('keydown', onEsc, true)
    return () => window.removeEventListener('keydown', onEsc, true)
  }, [textHelpOpen])

  useEffect(() => {
    if (!textHelpOpen) return
    if (richTextHelpVariantFromStore() == null) setTextHelpOpen(false)
  }, [textHelpOpen, selectedIds, canvasInlineEditId, focusedTextRunIndex])

  const primary = selectedIds.length === 1 ? selectedIds[0] : null
  const el = primary ? findElementByIdInDocumentDeep(pages, primary) : undefined

  useEffect(() => {
    if (!primary) return
    const e = findElementByIdInDocumentDeep(pages, primary)
    if (!e || !isRichTextElement(e)) return
    if (canvasInlineEditId !== e.id) return
    richTextDebugLog('context-toolbar', 'canvas inline + TipTap toolbar wiring', {
      elId: e.id,
      elType: e.type,
      canvasInlineEditId,
      hasInlineTipTapEditor: !!inlineTipTapRaw,
      inlineEditorDestroyed: inlineTipTapRaw?.isDestroyed,
    })
  }, [primary, pages, canvasInlineEditId, inlineTipTapRaw])

  const textHelpDialog =
    textHelpOpen &&
    createPortal(
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 p-4"
        role="presentation"
        onClick={() => setTextHelpOpen(false)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ag-rich-text-help-title"
          data-agreemint-rich-text-help-dialog
          className="max-h-[min(90vh,28rem)] max-w-md overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-600 dark:bg-zinc-900"
          onClick={(e) => e.stopPropagation()}
        >
          <h2
            id="ag-rich-text-help-title"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
          >
            {textHelpVariant === 'merge-field' ? 'Merge fields on canvas' : 'Editing text on canvas'}
          </h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
            {textHelpVariant === 'merge-field' ? RICH_TEXT_FIELD_SEGMENT_HINT_LONG : RICH_TEXT_CANVAS_HINT_LONG}
          </p>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Shortcut: <span className="font-mono">⌘/Ctrl+Shift+H</span> toggles this window when focus is on the
            canvas or top toolbar (not the side panels or status bar). Press Escape or click outside to close.
          </p>
          <button
            type="button"
            className="mt-4 rounded-md border border-zinc-300 bg-zinc-50 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
            onClick={() => setTextHelpOpen(false)}
          >
            Close
          </button>
        </div>
      </div>,
      document.body
    )

  let body: ReactNode = null

  if (el && isRichTextElement(el)) {
    const runs = parseContentToRuns(el.content)
    const isCanvasEditing = canvasInlineEditId === el.id
    const chrome = <TextElementChrome el={el} updateElement={updateElement} />

    let formatSection: ReactNode
    if (isCanvasEditing) {
      formatSection = (
        <RichTextTipTapToolbar editor={tipTapToolbarEditor} canvasEditing={isCanvasEditing} />
      )
    } else if (focusedTextRunIndex != null && focusedTextRunIndex < runs.length) {
      const r = runs[focusedTextRunIndex]
      if (r?.type === 'text') {
        formatSection = (
          <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto">
            <RichTextFormatToolbar
              bold={!!r.bold}
              italic={!!r.italic}
              underline={!!r.underline}
              strikethrough={!!r.strikethrough}
              superscript={!!r.superscript}
              subscript={!!r.subscript}
              onToggle={(key) => patchTextRunFormat(el, focusedTextRunIndex, key, updateElement)}
            />
            <div
              className="flex shrink-0 flex-nowrap items-center gap-1 border-b border-zinc-200 bg-zinc-50/90 px-1 py-1 dark:border-zinc-600 dark:bg-zinc-800/60"
              onMouseDown={(e) => e.preventDefault()}
            >
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Selection</span>
              <ColorToolbarSwatch
                title="Text color (this segment)"
                value={r.color}
                onChange={(v) =>
                  patchTextRunColor(el, focusedTextRunIndex, 'color', v, updateElement)
                }
                onClear={() =>
                  patchTextRunColor(el, focusedTextRunIndex, 'color', undefined, updateElement)
                }
              />
              <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">HL</span>
              <ColorToolbarSwatch
                title="Highlight (this segment)"
                value={r.highlightColor}
                onChange={(v) =>
                  patchTextRunColor(el, focusedTextRunIndex, 'highlightColor', v, updateElement)
                }
                onClear={() =>
                  patchTextRunColor(
                    el,
                    focusedTextRunIndex,
                    'highlightColor',
                    undefined,
                    updateElement
                  )
                }
              />
            </div>
          </div>
        )
      } else {
        formatSection = null
      }
    } else {
      formatSection = null
    }

    body = (
      <div
        className="flex min-w-0 flex-1 flex-nowrap items-center gap-x-1.5 lg:gap-x-3"
        onMouseDownCapture={(e) => isCanvasEditing && e.button === 0 && e.preventDefault()}
      >
        {formatSection ? (
          <>
            <div className="flex min-h-0 min-w-0 flex-1 items-center overflow-x-auto">{formatSection}</div>
            <div className="hidden h-6 shrink-0 self-center sm:block sm:w-px sm:bg-zinc-300 dark:sm:bg-zinc-600" />
          </>
        ) : null}
        <div className={`min-w-0 overflow-x-auto ${formatSection ? 'sm:shrink-0' : 'flex-1'}`}>{chrome}</div>
      </div>
    )
  } else if (el?.type === 'TABLE') {
    body = <TableContextToolbar el={el} />
  } else if (el?.type === 'IMAGE') {
    const st = el.style
    body = (
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Image</span>
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Border</span>
        <ColorToolbarSwatch
          title="Border color"
          value={st?.color}
          onChange={(v) =>
            updateElement(el.id, { style: mergeElementStyle(st, { color: v }) })
          }
          onClear={() => updateElement(el.id, { style: omitStyleKey(st, 'color') })}
        />
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Fill</span>
        <ColorToolbarSwatch
          title="Backdrop color"
          value={st?.backgroundColor}
          onChange={(v) =>
            updateElement(el.id, {
              style: mergeElementStyle(st, { backgroundColor: v }),
            })
          }
          onClear={() => updateElement(el.id, { style: omitStyleKey(st, 'backgroundColor') })}
        />
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">· URL & size in Properties</span>
      </div>
    )
  } else if (el?.type === 'LINE') {
    const sw = el.strokeWidth ?? 1
    const st = el.style
    const setStroke = (next: number) =>
      updateElement(el.id, { strokeWidth: Math.max(0.5, next) })
    body = (
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Line</span>
        <button type="button" className={TOOLBAR_CHIP_CLASS} title="Decrease stroke width" aria-label="Thinner" onClick={() => setStroke(sw - 0.5)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M5 12h14" /></svg>
        </button>
        <button type="button" className={TOOLBAR_CHIP_CLASS} title="Increase stroke width" aria-label="Thicker" onClick={() => setStroke(sw + 0.5)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{sw}px</span>
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Stroke</span>
        <ColorToolbarSwatch
          title="Line color"
          value={st?.color}
          onChange={(v) =>
            updateElement(el.id, { style: mergeElementStyle(st, { color: v }) })
          }
          onClear={() => updateElement(el.id, { style: omitStyleKey(st, 'color') })}
        />
      </div>
    )
  } else if (el?.type === 'BOX') {
    const st = el.style
    body = (
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Box</span>
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Border</span>
        <ColorToolbarSwatch
          title="Border color"
          value={st?.color}
          onChange={(v) =>
            updateElement(el.id, { style: mergeElementStyle(st, { color: v }) })
          }
          onClear={() => updateElement(el.id, { style: omitStyleKey(st, 'color') })}
        />
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Fill</span>
        <ColorToolbarSwatch
          title="Fill color"
          value={st?.backgroundColor}
          onChange={(v) =>
            updateElement(el.id, {
              style: mergeElementStyle(st, { backgroundColor: v }),
            })
          }
          onClear={() => updateElement(el.id, { style: omitStyleKey(st, 'backgroundColor') })}
        />
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">· Layout in Properties</span>
      </div>
    )
  } else if (
    el &&
    (el.type === 'ELLIPSE' ||
      el.type === 'TRIANGLE' ||
      el.type === 'ARROW' ||
      el.type === 'DIAMOND' ||
      el.type === 'STAR' ||
      el.type === 'RING' ||
      el.type === 'MERGED_SHAPE')
  ) {
    const sw = el.strokeWidth ?? 2
    const st = el.style
    const setStroke = (next: number) =>
      updateElement(el.id, { strokeWidth: Math.max(0.5, next) })
    const label =
      el.type === 'MERGED_SHAPE'
        ? 'Merged'
        : el.type === 'ELLIPSE'
          ? 'Ellipse'
          : el.type === 'TRIANGLE'
            ? 'Triangle'
            : el.type === 'ARROW'
              ? 'Arrow'
              : el.type === 'DIAMOND'
                ? 'Diamond'
                : el.type === 'RING'
                  ? 'Ring'
                  : 'Star'
    body = (
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{label}</span>
        <button type="button" className={TOOLBAR_CHIP_CLASS} title="Decrease stroke width" aria-label="Thinner" onClick={() => setStroke(sw - 0.5)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M5 12h14" /></svg>
        </button>
        <button type="button" className={TOOLBAR_CHIP_CLASS} title="Increase stroke width" aria-label="Thicker" onClick={() => setStroke(sw + 0.5)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{sw}px</span>
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Stroke</span>
        <ColorToolbarSwatch
          title="Outline color"
          value={st?.color}
          onChange={(v) =>
            updateElement(el.id, { style: mergeElementStyle(st, { color: v }) })
          }
          onClear={() => updateElement(el.id, { style: omitStyleKey(st, 'color') })}
        />
        <span className="text-[10px] text-zinc-500 dark:text-zinc-400">Fill</span>
        <ColorToolbarSwatch
          title="Fill color"
          value={st?.backgroundColor}
          onChange={(v) =>
            updateElement(el.id, {
              style: mergeElementStyle(st, { backgroundColor: v }),
            })
          }
          onClear={() => updateElement(el.id, { style: omitStyleKey(st, 'backgroundColor') })}
        />
      </div>
    )
  }

  if (!el) {
    return (
      <>
        <div
          ref={containerRef}
          data-agreemint-context-toolbar
          className="flex min-h-[2.25rem] min-w-0 flex-1 items-center border-l border-zinc-200 pl-4 dark:border-zinc-600"
        >
          <p className="text-xs text-zinc-400 dark:text-zinc-500">Select an element</p>
        </div>
        {textHelpDialog}
      </>
    )
  }

  const scrollClass =
    el.type === 'TABLE' ? 'min-w-0 flex-1 overflow-visible' : 'min-w-0 flex-1 overflow-x-auto'

  return (
    <>
      <div
        ref={containerRef}
        data-agreemint-context-toolbar
        className="flex min-h-[2.25rem] min-w-0 flex-1 items-center border-l border-zinc-200 py-0.5 pl-4 dark:border-zinc-600"
      >
        <div className={scrollClass}>{body}</div>
      </div>
      {textHelpDialog}
    </>
  )
}
