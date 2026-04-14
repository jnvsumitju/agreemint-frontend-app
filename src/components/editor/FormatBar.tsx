import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { createPortal } from 'react-dom'
import { FONT_SIZE_MIN, FONT_SIZE_MAX } from '../../lib/editorConstants'
import { FONT_LIST, loadFont } from '../../lib/fontLoader'
import { mergeElementStyle, omitStyleKey, omitGradientKey, patchTextRunColor, patchTextRunFormat } from '../../lib/elementStyleHelpers'
import type { GradientDef } from '../../types/layout'
import { richTextDebugLog } from '../../lib/richTextDebugLog'
import { parseContentToRuns } from '../../lib/richContent'
import {
  activeCanvasTipTapEditorByElementId,
  useEditorStore,
} from '../../stores/editorStore'
import { findElementByIdInDocumentDeep } from '../../lib/bandNestedLayout'
import { isRichTextElement } from '../../types/layout'
import type { ElementStyle, LayoutElement } from '../../types/layout'
import { ColorToolbarSwatch } from './ColorPalettePopover'
import { TableContextToolbar } from './TableContextToolbar'
import { RichTextFormatToolbar } from './RichTextFormatToolbar'
import { RichTextTipTapToolbar } from './RichTextTipTapToolbar'
import {
  IconBold, IconItalic, IconUnderline, IconStrikethrough,
  IconAlignLeft, IconAlignCenter, IconAlignRight,
  IconMinus, IconPlus, IconPaintBucket, IconBorderColor,
} from './ToolbarIcons'
import { TOOLBAR_ICON_BTN, TOOLBAR_ICON_BTN_ACTIVE, TOOLBAR_DIVIDER } from './uiClasses'

/* ------------------------------------------------------------------ */
/*  TipTap editor resolution                                           */
/* ------------------------------------------------------------------ */

function resolveLiveEditor(): Editor | null {
  const st = useEditorStore.getState()
  const editId = st.canvasInlineEditId
  if (editId) {
    const e = activeCanvasTipTapEditorByElementId.get(editId)
    if (e && !e.isDestroyed) return e
  }
  const cellEdit = st.tableCellEdit
  if (cellEdit) {
    const e = activeCanvasTipTapEditorByElementId.get(`table-${cellEdit.tableId}-cell`)
    if (e && !e.isDestroyed) return e
  }
  const e = st.inlineTipTapEditor
  return e && !e.isDestroyed ? e : null
}

function execCmd(label: string, run: (ed: Editor) => boolean) {
  const ed = resolveLiveEditor()
  if (!ed || ed.isDestroyed) return
  run(ed)
}

/* ------------------------------------------------------------------ */
/*  Rich-text help dialog support (ported from EditorContextToolbar)    */
/* ------------------------------------------------------------------ */

const RICH_TEXT_CANVAS_HINT_LONG =
  'Double-click the text on the page to edit inline. While editing, use the top bar for bold, italic, underline, strikethrough, super/subscript, text color, and highlight. Press Escape to cancel or ⌘/Ctrl+Enter to finish.'

const RICH_TEXT_FIELD_SEGMENT_HINT_LONG =
  'A merge field is selected. Double-click the text to edit; bold, italic, and colors apply to text runs, not to merge fields.'

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

/* ------------------------------------------------------------------ */
/*  Shared UI components                                               */
/* ------------------------------------------------------------------ */

function FmtBtn({
  active,
  disabled,
  title,
  children,
  onMouseDown,
}: {
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
  onMouseDown: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      className={active ? TOOLBAR_ICON_BTN_ACTIVE : TOOLBAR_ICON_BTN}
      onMouseDown={(e) => {
        e.preventDefault()
        if (!disabled) onMouseDown()
      }}
      onClick={(e) => e.preventDefault()}
    >
      {children}
    </button>
  )
}

const SEP = <span className={TOOLBAR_DIVIDER} aria-hidden />

/* ------------------------------------------------------------------ */
/*  Custom styled dropdown components (portaled to escape overflow)     */
/* ------------------------------------------------------------------ */

/** Chevron-down arrow for dropdown triggers. */
const DropdownChevron = () => (
  <svg
    className="h-3 w-3 shrink-0 text-zinc-400"
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M3 5l3 3 3-3" />
  </svg>
)

/* ---- Text Style Preset Dropdown ---- */

function TextStylePresetDropdown({
  value,
  disabled,
  onChange,
}: {
  value: string
  disabled?: boolean
  onChange: (preset: TextStylePreset) => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  // Click-outside: close when clicking outside both trigger and panel
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggle = () => {
    if (open) { setOpen(false); return }
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: r.left })
    setOpen(true)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title="Text style"
        className={`flex h-6 max-w-[7.5rem] items-center gap-1 truncate rounded border border-zinc-200 bg-white px-1.5 text-[11px] text-zinc-700 hover:bg-zinc-50 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700${disabled ? ' cursor-not-allowed opacity-30' : ' cursor-pointer'}`}
        onMouseDown={(e) => {
          e.preventDefault()
          if (!disabled) toggle()
        }}
      >
        <span className="truncate">{value || 'Style'}</span>
        <DropdownChevron />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[100] min-w-[11rem] overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-600 dark:bg-zinc-800"
            style={{ top: pos.top, left: pos.left }}
          >
            {TEXT_STYLE_PRESETS.map((p) => {
              // Preview at ~65% of actual size — keeps proportions visible in toolbar
              const previewSize = Math.max(10, Math.round(p.fontSize * 0.65))
              return (
                <button
                  key={p.label}
                  type="button"
                  className={`flex w-full items-center px-2.5 py-1 text-left hover:bg-indigo-50 dark:hover:bg-zinc-700${value === p.label ? ' bg-indigo-50 dark:bg-zinc-700' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onChange(p)
                    setOpen(false)
                  }}
                >
                  <span
                    style={{ fontSize: `${previewSize}px`, fontWeight: p.bold ? 700 : 400, lineHeight: 1.4 }}
                    className="text-zinc-800 dark:text-zinc-100"
                  >
                    {p.label}
                  </span>
                  <span className="ml-auto pl-3 text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
                    {p.fontSize}pt
                  </span>
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </>
  )
}

/* ---- Font Family Dropdown ---- */

function FontFamilyDropdown({
  value,
  disabled,
  onChange,
}: {
  value: string
  disabled?: boolean
  onChange: (family: string) => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  // Click-outside: close when clicking outside both trigger and panel
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Preload all Google Fonts when dropdown opens so previews render correctly
  useEffect(() => {
    if (!open) return
    for (const f of FONT_LIST) {
      if (!f.builtIn) loadFont(f.family)
    }
  }, [open])

  const toggle = () => {
    if (open) { setOpen(false); return }
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: r.left })
    setOpen(true)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        title="Font family"
        className={`flex h-6 max-w-[8.5rem] items-center gap-1 truncate rounded border border-zinc-200 bg-white px-1.5 text-[11px] text-zinc-700 hover:bg-zinc-50 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700${disabled ? ' cursor-not-allowed opacity-30' : ' cursor-pointer'}`}
        style={value ? { fontFamily: value } : undefined}
        onMouseDown={(e) => {
          e.preventDefault()
          if (!disabled) toggle()
        }}
      >
        <span className="truncate">{value || 'Default'}</span>
        <DropdownChevron />
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[100] max-h-[20rem] min-w-[13rem] overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-600 dark:bg-zinc-800"
            style={{ top: pos.top, left: pos.left }}
          >
            {/* Default (system font) */}
            <button
              type="button"
              className={`flex w-full items-center px-2.5 py-1.5 text-left text-[12px] hover:bg-indigo-50 dark:hover:bg-zinc-700${!value ? ' bg-indigo-50 dark:bg-zinc-700' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                onChange('')
                setOpen(false)
              }}
            >
              <span className="text-zinc-800 dark:text-zinc-100">Default</span>
            </button>
            <div className="my-0.5 border-t border-zinc-100 dark:border-zinc-700" />
            {FONT_LIST.map((f) => (
              <button
                key={f.family}
                type="button"
                className={`flex w-full items-center px-2.5 py-1 text-left hover:bg-indigo-50 dark:hover:bg-zinc-700${value === f.family ? ' bg-indigo-50 dark:bg-zinc-700' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onChange(f.family)
                  setOpen(false)
                }}
              >
                <span
                  style={{ fontFamily: f.family }}
                  className="text-[13px] text-zinc-800 dark:text-zinc-100"
                >
                  {f.family}
                </span>
                {f.builtIn && (
                  <span className="ml-auto pl-3 text-[9px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    System
                  </span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Stroke width stepper (LINE, shapes)                                */
/* ------------------------------------------------------------------ */

function StrokeWidthStepper({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-0.5 rounded border border-zinc-200 bg-white dark:border-zinc-600 dark:bg-zinc-800">
      <button
        type="button"
        title="Decrease stroke width"
        disabled={disabled}
        className="px-1 py-0.5 text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-700"
        onMouseDown={(e) => {
          e.preventDefault()
          onChange(Math.max(0.5, value - 0.5))
        }}
      >
        <IconMinus size={12} />
      </button>
      <span className="min-w-[1.5rem] select-none text-center text-[10px] tabular-nums text-zinc-600 dark:text-zinc-200">
        {disabled ? '--' : value}
      </span>
      <button
        type="button"
        title="Increase stroke width"
        disabled={disabled}
        className="px-1 py-0.5 text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-700"
        onMouseDown={(e) => {
          e.preventDefault()
          onChange(value + 0.5)
        }}
      >
        <IconPlus size={12} />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Text style presets (heading / body)                                */
/* ------------------------------------------------------------------ */

interface TextStylePreset {
  label: string
  fontSize: number
  bold: boolean
}

const TEXT_STYLE_PRESETS: TextStylePreset[] = [
  { label: 'Heading 1', fontSize: 28, bold: true },
  { label: 'Heading 2', fontSize: 24, bold: true },
  { label: 'Heading 3', fontSize: 20, bold: true },
  { label: 'Heading 4', fontSize: 16, bold: true },
  { label: 'Normal',    fontSize: 12, bold: false },
  { label: 'Small',     fontSize: 10, bold: false },
]

function detectCurrentPreset(style: ElementStyle): string {
  const fs = style.fontSize ?? 12
  const bold = !!style.bold
  for (const p of TEXT_STYLE_PRESETS) {
    if (p.fontSize === fs && p.bold === bold) return p.label
  }
  return ''
}

/* ------------------------------------------------------------------ */
/*  FormatBar — universal context-sensitive toolbar (Row 2)            */
/* ------------------------------------------------------------------ */

export function FormatBar({
  contextToolbarExemptRef,
}: {
  contextToolbarExemptRef?: RefObject<HTMLDivElement | null>
}) {
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const pages = useEditorStore((s) => s.pages)
  const canvasInlineEditId = useEditorStore((s) => s.canvasInlineEditId)
  const tableCellEdit = useEditorStore((s) => s.tableCellEdit)
  const focusedTextRunIndex = useEditorStore((s) => s.focusedTextRunIndex)
  const updateElement = useEditorStore((s) => s.updateElement)
  const inlineTipTapRaw = useEditorStore((s) => s.inlineTipTapEditor)
  const setInlineTipTapEditor = useEditorStore((s) => s.setInlineTipTapEditor)
  const groupSelection = useEditorStore((s) => s.groupSelection)
  const ungroupSelection = useEditorStore((s) => s.ungroupSelection)
  const bandEditorMode = useEditorStore((s) => s.bandCanvasEditElementId) != null

  // Rich-text help dialog state
  const [textHelpOpen, setTextHelpOpen] = useState(false)
  const [textHelpVariant, setTextHelpVariant] = useState<'canvas' | 'merge-field'>('canvas')

  // TipTap cleanup for destroyed editors
  useLayoutEffect(() => {
    const raw = inlineTipTapRaw
    if (!raw?.isDestroyed) return
    if (useEditorStore.getState().inlineTipTapEditor !== raw) return
    setInlineTipTapEditor(null)
  }, [inlineTipTapRaw, setInlineTipTapEditor])

  const tipTapToolbarEditor =
    inlineTipTapRaw && !inlineTipTapRaw.isDestroyed ? inlineTipTapRaw : null

  // Rich-text help shortcut handler
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

  // Debug logging for TipTap wiring
  const primary = selectedIds.length === 1 ? selectedIds[0] : null
  const el = primary ? findElementByIdInDocumentDeep(pages, primary) : undefined

  useEffect(() => {
    if (!primary) return
    const e = findElementByIdInDocumentDeep(pages, primary)
    if (!e || !isRichTextElement(e)) return
    if (canvasInlineEditId !== e.id) return
    richTextDebugLog('format-bar', 'canvas inline + TipTap toolbar wiring', {
      elId: e.id,
      elType: e.type,
      canvasInlineEditId,
      hasInlineTipTapEditor: !!inlineTipTapRaw,
      inlineEditorDestroyed: inlineTipTapRaw?.isDestroyed,
    })
  }, [primary, pages, canvasInlineEditId, inlineTipTapRaw])

  const isText = el != null && isRichTextElement(el)
  const isList = el?.type === 'LIST'
  const isInline = canvasInlineEditId != null || tableCellEdit != null
  const isTable = el?.type === 'TABLE'
  const isLine = el?.type === 'LINE'
  const isBox = el?.type === 'BOX'
  const isImage = el?.type === 'IMAGE'
  const isShape =
    el != null &&
    (el.type === 'ELLIPSE' ||
      el.type === 'TRIANGLE' ||
      el.type === 'ARROW' ||
      el.type === 'DIAMOND' ||
      el.type === 'STAR' ||
      el.type === 'RING' ||
      el.type === 'MERGED_SHAPE')
  const hasStroke = isLine || isShape
  const hasBorderFill = isBox || isImage || isShape
  const noElement = !el
  const textDisabled = !isText && !isList && !isInline

  const style: ElementStyle = el?.style ?? {}
  const fs = Math.round(style.fontSize ?? 12)
  const align = style.align ?? 'left'
  const strokeWidth = (el as LayoutElement | undefined)?.strokeWidth ?? (isLine ? 1 : 2)

  // TipTap reactive format state
  const tipTapEditor = useMemo(() => {
    if (!isInline) return null
    return resolveLiveEditor()
  }, [isInline, canvasInlineEditId, tableCellEdit])

  const fmt = useEditorState({
    editor: tipTapEditor,
    selector: ({ editor: ed }) => ({
      bold: ed?.isActive('bold') ?? false,
      italic: ed?.isActive('italic') ?? false,
      underline: ed?.isActive('underline') ?? false,
      strike: ed?.isActive('strike') ?? false,
    }),
  })

  // Element-level style patching
  const patchStyle = (patch: Partial<ElementStyle>) => {
    if (!el) return
    updateElement(el.id, { style: mergeElementStyle(style, patch) })
  }

  // Active states — TipTap when inline, element style when not
  const boldActive = isInline ? (fmt?.bold ?? false) : !!style.bold
  const italicActive = isInline ? (fmt?.italic ?? false) : !!style.italic
  const underlineActive = isInline ? (fmt?.underline ?? false) : false
  const strikeActive = isInline ? (fmt?.strike ?? false) : false

  // Action handlers — TipTap commands when inline, style patch when not
  const toggleBold = () => {
    if (isInline) execCmd('bold', (ed) => ed.chain().focus().toggleBold().run())
    else if (el) patchStyle({ bold: !style.bold })
  }
  const toggleItalic = () => {
    if (isInline) execCmd('italic', (ed) => ed.chain().focus().toggleItalic().run())
    else if (el) patchStyle({ italic: !style.italic })
  }
  const toggleUnderline = () => {
    if (isInline) execCmd('underline', (ed) => ed.chain().focus().toggleUnderline().run())
  }
  const toggleStrike = () => {
    if (isInline) execCmd('strike', (ed) => ed.chain().focus().toggleStrike().run())
  }

  // Color handlers
  const setTextColor = (v: string) => {
    if (isInline) execCmd('setColor', (ed) => ed.chain().focus().setColor(v).run())
    else if (el) patchStyle({ color: v })
  }
  const clearTextColor = () => {
    if (isInline) execCmd('unsetColor', (ed) => ed.chain().focus().unsetColor().run())
    else if (el) updateElement(el.id, { style: omitStyleKey(style, 'color') })
  }
  const setBgColor = (v: string) => {
    if (isInline) execCmd('highlight', (ed) => ed.chain().focus().toggleHighlight({ color: v }).run())
    else if (el) patchStyle({ backgroundColor: v })
  }
  const clearBgColor = () => {
    if (isInline) execCmd('unsetHighlight', (ed) => ed.chain().focus().unsetHighlight().run())
    else if (el) updateElement(el.id, { style: omitStyleKey(style, 'backgroundColor') })
  }

  // Stroke/fill handlers for non-text elements
  const setStrokeColor = (v: string) => {
    if (el) updateElement(el.id, { style: mergeElementStyle(style, { color: v }) })
  }
  const clearStrokeColor = () => {
    if (el) updateElement(el.id, { style: omitStyleKey(style, 'color') })
  }
  const setFillColor = (v: string) => {
    if (el) updateElement(el.id, { style: mergeElementStyle(style, { backgroundColor: v }) })
  }
  const clearFillColor = () => {
    if (el) updateElement(el.id, { style: omitStyleKey(style, 'backgroundColor') })
  }
  const setStrokeWidth = (v: number) => {
    if (el) updateElement(el.id, { strokeWidth: Math.max(0.5, v) })
  }

  // Gradient handlers
  const setTextGradient = (g: GradientDef | undefined) => {
    if (el) patchStyle({ colorGradient: g ?? undefined })
  }
  const setBgGradient = (g: GradientDef | undefined) => {
    if (el) patchStyle({ bgGradient: g ?? undefined })
  }
  const setStrokeGradient = (g: GradientDef | undefined) => {
    if (el) updateElement(el.id, { style: mergeElementStyle(style, { colorGradient: g ?? undefined }) })
  }
  const setFillGradient = (g: GradientDef | undefined) => {
    if (el) updateElement(el.id, { style: mergeElementStyle(style, { bgGradient: g ?? undefined }) })
  }

  // Focused-text-run format section (ported from EditorContextToolbar)
  let focusedRunSection: React.ReactNode = null
  if (isText && el && focusedTextRunIndex != null) {
    const runs = parseContentToRuns(el.content)
    const r = runs[focusedTextRunIndex]
    if (r?.type === 'text') {
      focusedRunSection = (
        <>
          {SEP}
          <div className="flex shrink-0 items-center gap-1" onMouseDown={(e) => e.preventDefault()}>
            <RichTextFormatToolbar
              bold={!!r.bold}
              italic={!!r.italic}
              underline={!!r.underline}
              strikethrough={!!r.strikethrough}
              superscript={!!r.superscript}
              subscript={!!r.subscript}
              onToggle={(key) => patchTextRunFormat(el, focusedTextRunIndex, key, updateElement)}
            />
            <span className="text-[10px] font-medium text-zinc-400 dark:text-zinc-500">Sel</span>
            <ColorToolbarSwatch
              title="Text color (this segment)"
              value={r.color}
              onChange={(v) => patchTextRunColor(el, focusedTextRunIndex, 'color', v, updateElement)}
              onClear={() => patchTextRunColor(el, focusedTextRunIndex, 'color', undefined, updateElement)}
            />
            <ColorToolbarSwatch
              title="Highlight (this segment)"
              value={r.highlightColor}
              onChange={(v) => patchTextRunColor(el, focusedTextRunIndex, 'highlightColor', v, updateElement)}
              onClear={() => patchTextRunColor(el, focusedTextRunIndex, 'highlightColor', undefined, updateElement)}
            />
          </div>
        </>
      )
    }
  }

  // TipTap inline editing toolbar
  let inlineFormatSection: React.ReactNode = null
  if (isText && el && canvasInlineEditId === el.id) {
    inlineFormatSection = (
      <>
        {SEP}
        <div className="flex shrink-0 items-center">
          <RichTextTipTapToolbar editor={tipTapToolbarEditor} canvasEditing />
        </div>
      </>
    )
  }

  // Rich-text help dialog
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
          <h2 id="ag-rich-text-help-title" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {textHelpVariant === 'merge-field' ? 'Merge fields on canvas' : 'Editing text on canvas'}
          </h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
            {textHelpVariant === 'merge-field' ? RICH_TEXT_FIELD_SEGMENT_HINT_LONG : RICH_TEXT_CANVAS_HINT_LONG}
          </p>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Shortcut: <span className="font-mono">{'\u2318'}/Ctrl+Shift+H</span> toggles this window.
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

  const viewOnly = useEditorStore((s) => s.viewOnly)

  // View-only mode: show informational bar
  if (viewOnly) {
    return (
      <div
        className="flex h-8 shrink-0 items-center gap-2 border-b border-zinc-200 bg-amber-50/60 px-3 dark:border-zinc-700 dark:bg-amber-900/10"
        role="toolbar"
        aria-label="View-only mode"
      >
        <svg className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </svg>
        <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
          View-only mode — hover elements to comment, right-click for options
        </span>
      </div>
    )
  }

  // Multi-selection: show group/ungroup
  if (selectedIds.length > 1) {
    const anyGrouped = selectedIds.some((id) => {
      const e = findElementByIdInDocumentDeep(pages, id)
      return e?.groupId != null
    })
    return (
      <div
        ref={contextToolbarExemptRef}
        data-agreemint-context-toolbar
        className="flex h-8 shrink-0 items-center gap-2 overflow-hidden border-b border-zinc-200 bg-zinc-50/80 px-3 dark:border-zinc-700 dark:bg-zinc-900/80"
        role="toolbar"
        aria-label="Multi-selection"
      >
        <span className="text-[10px] font-semibold text-violet-700 dark:text-violet-300">
          {selectedIds.length} selected
        </span>
        {SEP}
        <button
          type="button"
          className={`${TOOLBAR_ICON_BTN} px-2 text-[11px] font-medium`}
          disabled={bandEditorMode || selectedIds.length < 2}
          title="Group selected elements"
          onMouseDown={(e) => { e.preventDefault(); groupSelection() }}
        >
          Group
        </button>
        <button
          type="button"
          className={`${TOOLBAR_ICON_BTN} px-2 text-[11px] font-medium`}
          disabled={bandEditorMode || !anyGrouped}
          title="Ungroup selected elements"
          onMouseDown={(e) => { e.preventDefault(); ungroupSelection() }}
        >
          Ungroup
        </button>
      </div>
    )
  }

  // Table: delegate entirely
  if (isTable && el) {
    return (
      <>
        <div
          ref={contextToolbarExemptRef}
          data-agreemint-context-toolbar
          className="flex h-8 shrink-0 items-center overflow-hidden border-b border-zinc-200 bg-zinc-50/80 px-3 dark:border-zinc-700 dark:bg-zinc-900/80"
          role="toolbar"
          aria-label="Table formatting"
          onMouseDown={(e) => { if (isInline) e.preventDefault() }}
        >
          <TableContextToolbar el={el} />
        </div>
        {textHelpDialog}
      </>
    )
  }

  return (
    <>
      <div
        ref={contextToolbarExemptRef}
        data-agreemint-context-toolbar
        className={`flex h-8 shrink-0 items-center gap-1 overflow-hidden border-b border-zinc-200 bg-zinc-50/80 px-3 transition-opacity dark:border-zinc-700 dark:bg-zinc-900/80${noElement ? ' opacity-40' : ''}`}
        role="toolbar"
        aria-label="Element formatting"
        onMouseDown={(e) => {
          if (isInline) e.preventDefault()
        }}
      >
        {/* ---- Text Style Preset ---- */}
        <TextStylePresetDropdown
          value={textDisabled ? '' : detectCurrentPreset(style)}
          disabled={textDisabled || isInline}
          onChange={(preset) => {
            if (el) patchStyle({ fontSize: preset.fontSize, bold: preset.bold })
          }}
        />

        {SEP}

        {/* ---- Font Family ---- */}
        <FontFamilyDropdown
          value={textDisabled ? '' : (style.fontFamily ?? '')}
          disabled={textDisabled || isInline}
          onChange={(family) => {
            if (family) {
              loadFont(family)
              patchStyle({ fontFamily: family })
            } else {
              if (el) updateElement(el.id, { style: omitStyleKey(style, 'fontFamily') })
            }
          }}
        />

        {SEP}

        {/* ---- Font Size Group ---- */}
        <div className={`flex items-center gap-0.5 rounded border border-zinc-200 bg-white dark:border-zinc-600 dark:bg-zinc-800${textDisabled && !noElement ? ' opacity-30' : ''}`}>
          <button
            type="button"
            title="Decrease font size"
            disabled={textDisabled || isInline}
            className="px-1 py-0.5 text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-700"
            onMouseDown={(e) => {
              e.preventDefault()
              patchStyle({ fontSize: Math.max(FONT_SIZE_MIN, fs - 1) })
            }}
          >
            <IconMinus size={12} />
          </button>
          <span className="min-w-[1.75rem] select-none text-center text-xs tabular-nums text-zinc-700 dark:text-zinc-200">
            {textDisabled ? '--' : fs}
          </span>
          <button
            type="button"
            title="Increase font size"
            disabled={textDisabled || isInline}
            className="px-1 py-0.5 text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-700"
            onMouseDown={(e) => {
              e.preventDefault()
              patchStyle({ fontSize: Math.min(FONT_SIZE_MAX, fs + 1) })
            }}
          >
            <IconPlus size={12} />
          </button>
        </div>

        {/* ---- Line Height ---- */}
        <div className={`flex items-center gap-0.5 rounded border border-zinc-200 bg-white dark:border-zinc-600 dark:bg-zinc-800${textDisabled && !noElement ? ' opacity-30' : ''}`}>
          <button
            type="button"
            title="Decrease line height"
            disabled={textDisabled || isInline}
            className="px-1 py-0.5 text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-700"
            onMouseDown={(e) => {
              e.preventDefault()
              patchStyle({ lineHeight: Math.max(0.8, Math.round(((style.lineHeight ?? 1.4) - 0.1) * 10) / 10) })
            }}
          >
            <IconMinus size={12} />
          </button>
          <span
            className="min-w-[2rem] select-none text-center text-[10px] tabular-nums text-zinc-700 dark:text-zinc-200"
            title="Line height"
          >
            {textDisabled ? '--' : (style.lineHeight ?? 1.4).toFixed(1)}
          </span>
          <button
            type="button"
            title="Increase line height"
            disabled={textDisabled || isInline}
            className="px-1 py-0.5 text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 dark:text-zinc-300 dark:hover:bg-zinc-700"
            onMouseDown={(e) => {
              e.preventDefault()
              patchStyle({ lineHeight: Math.min(3.0, Math.round(((style.lineHeight ?? 1.4) + 0.1) * 10) / 10) })
            }}
          >
            <IconPlus size={12} />
          </button>
        </div>

        {SEP}

        {/* ---- Text Format Group (B/I/U/S) ---- */}
        <div className={`flex items-center gap-0.5${textDisabled && !noElement ? ' opacity-30' : ''}`}>
          <FmtBtn title="Bold (⌘B / Ctrl+B)" active={boldActive} disabled={textDisabled} onMouseDown={toggleBold}>
            <IconBold size={14} />
          </FmtBtn>
          <FmtBtn title="Italic (⌘I / Ctrl+I)" active={italicActive} disabled={textDisabled} onMouseDown={toggleItalic}>
            <IconItalic size={14} />
          </FmtBtn>
          <FmtBtn title="Underline (⌘U / Ctrl+U)" active={underlineActive} disabled={textDisabled || !isInline} onMouseDown={toggleUnderline}>
            <IconUnderline size={14} />
          </FmtBtn>
          <FmtBtn title="Strikethrough" active={strikeActive} disabled={textDisabled || !isInline} onMouseDown={toggleStrike}>
            <IconStrikethrough size={14} />
          </FmtBtn>
        </div>

        {SEP}

        {/* ---- Alignment Group ---- */}
        <div className={`flex items-center gap-0.5${textDisabled && !noElement ? ' opacity-30' : ''}`}>
          <FmtBtn title="Align left" active={!textDisabled && align === 'left'} disabled={textDisabled || isInline} onMouseDown={() => patchStyle({ align: 'left' })}>
            <IconAlignLeft size={14} />
          </FmtBtn>
          <FmtBtn title="Align center" active={!textDisabled && align === 'center'} disabled={textDisabled || isInline} onMouseDown={() => patchStyle({ align: 'center' })}>
            <IconAlignCenter size={14} />
          </FmtBtn>
          <FmtBtn title="Align right" active={!textDisabled && align === 'right'} disabled={textDisabled || isInline} onMouseDown={() => patchStyle({ align: 'right' })}>
            <IconAlignRight size={14} />
          </FmtBtn>
        </div>

        {SEP}

        {/* ---- Text Color Group ---- */}
        <div className={`flex items-center gap-1${textDisabled && !noElement ? ' opacity-30' : ''}`}>
          <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400" title="Text color">A</span>
          <ColorToolbarSwatch
            title="Text color"
            value={textDisabled ? undefined : style.color}
            onChange={textDisabled ? undefined : setTextColor}
            onClear={textDisabled || !style.color ? undefined : clearTextColor}
            gradient={textDisabled ? undefined : style.colorGradient}
            onGradientChange={textDisabled || isInline ? undefined : setTextGradient}
          />
          <span className="text-zinc-400 dark:text-zinc-500" title="Background / highlight">
            <IconPaintBucket size={12} />
          </span>
          <ColorToolbarSwatch
            title="Background / highlight"
            value={textDisabled ? undefined : style.backgroundColor}
            onChange={textDisabled ? undefined : setBgColor}
            onClear={textDisabled || !style.backgroundColor ? undefined : clearBgColor}
            gradient={textDisabled ? undefined : style.bgGradient}
            onGradientChange={textDisabled || isInline ? undefined : setBgGradient}
          />
        </div>

        {/* ---- Element-specific groups ---- */}

        {/* Stroke width (LINE, shapes) */}
        {hasStroke && el && (
          <>
            {SEP}
            <div className="flex items-center gap-1">
              <span className="text-zinc-400 dark:text-zinc-500" title="Stroke width">
                <IconBorderColor size={12} />
              </span>
              <StrokeWidthStepper value={strokeWidth} onChange={setStrokeWidth} />
              <span className="text-[10px] tabular-nums text-zinc-500 dark:text-zinc-400">{strokeWidth}px</span>
            </div>
          </>
        )}

        {/* Stroke / Border color (LINE, BOX, IMAGE, shapes) */}
        {(hasStroke || hasBorderFill) && el && (
          <>
            {!hasStroke && SEP}
            <div className="flex items-center gap-1">
              {hasStroke ? (
                <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Stroke</span>
              ) : (
                <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Border</span>
              )}
              <ColorToolbarSwatch
                title={hasStroke ? 'Stroke color' : 'Border color'}
                value={style.color}
                onChange={setStrokeColor}
                onClear={style.color ? clearStrokeColor : undefined}
                gradient={style.colorGradient}
                onGradientChange={setStrokeGradient}
              />
            </div>
          </>
        )}

        {/* Fill color (BOX, IMAGE, shapes) */}
        {hasBorderFill && el && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Fill</span>
            <ColorToolbarSwatch
              title="Fill color"
              value={style.backgroundColor}
              onChange={setFillColor}
              onClear={style.backgroundColor ? clearFillColor : undefined}
              gradient={style.bgGradient}
              onGradientChange={setFillGradient}
            />
          </div>
        )}

        {/* Line-only stroke color */}
        {isLine && el && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Color</span>
            <ColorToolbarSwatch
              title="Line color"
              value={style.color}
              onChange={setStrokeColor}
              onClear={style.color ? clearStrokeColor : undefined}
              gradient={style.colorGradient}
              onGradientChange={setStrokeGradient}
            />
          </div>
        )}

        {/* Focused text run + inline editing sections */}
        {focusedRunSection}
        {inlineFormatSection}

        {/* No selection hint */}
        {noElement && (
          <span className="text-xs text-zinc-400 dark:text-zinc-500">Select an element</span>
        )}
      </div>
      {textHelpDialog}
    </>
  )
}
