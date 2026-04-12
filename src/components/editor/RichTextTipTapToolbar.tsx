import { useEffect } from 'react'
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { richTextDebugLog } from '../../lib/richTextDebugLog'
import {
  activeCanvasTipTapEditorByElementId,
  useEditorStore,
} from '../../stores/editorStore'
import { ColorToolbarSwatch } from './ColorPalettePopover'

/** Prefer per-element map (survives stale unmount), then Zustand, then prop. */
function resolveLiveInlineEditor(editorProp: Editor | null): Editor | null {
  const st = useEditorStore.getState()
  const editId = st.canvasInlineEditId
  if (editId) {
    const fromMap = activeCanvasTipTapEditorByElementId.get(editId)
    if (fromMap) {
      if (fromMap.isDestroyed) {
        activeCanvasTipTapEditorByElementId.delete(editId)
        richTextDebugLog('toolbar', 'resolveLiveInlineEditor map entry destroyed', { editId })
      } else {
        return fromMap
      }
    }
  }
  const fromStore = st.inlineTipTapEditor
  if (fromStore && !fromStore.isDestroyed) return fromStore
  if (editorProp && !editorProp.isDestroyed) return editorProp
  return null
}

function execToolbarCommand(editorProp: Editor | null, label: string, run: (ed: Editor) => boolean) {
  const editor = resolveLiveInlineEditor(editorProp)
  if (!editor || editor.isDestroyed) {
    const s = useEditorStore.getState()
    const cid = s.canvasInlineEditId
    const mapEd = cid ? activeCanvasTipTapEditorByElementId.get(cid) : undefined
    richTextDebugLog('toolbar', label, 'skipped no live editor', {
      hadProp: !!editorProp,
      propDestroyed: editorProp?.isDestroyed,
      canvasInlineEditId: cid,
      mapSize: activeCanvasTipTapEditorByElementId.size,
      mapKeys: [...activeCanvasTipTapEditorByElementId.keys()],
      mapEntry: mapEd == null ? 'absent' : mapEd.isDestroyed ? 'destroyed' : 'live-unreachable',
    })
    return
  }
  const s0 = editor.state.selection
  richTextDebugLog('toolbar', label, 'before', {
    from: s0.from,
    to: s0.to,
    empty: s0.empty,
    isFocused: editor.isFocused,
    hasFocus: (() => {
      try {
        return editor.view.hasFocus()
      } catch {
        return false
      }
    })(),
    destroyed: editor.isDestroyed,
  })
  const ok = run(editor)
  const s1 = editor.state.selection
  richTextDebugLog('toolbar', label, 'after', {
    ok,
    from: s1.from,
    to: s1.to,
    empty: s1.empty,
  })
}

const INACTIVE_FMT = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  sup: false,
  sub: false,
}

/** Capture + preventDefault so focus stays in TipTap; otherwise selection is lost before mark toggles run. */
function toolbarMouseDownCapture(e: React.MouseEvent) {
  if (e.button !== 0) return
  e.preventDefault()
}

function ToolbarBtn({
  active,
  label,
  onMouseDown,
  children,
}: {
  active?: boolean
  label: string
  onMouseDown: (e: React.MouseEvent) => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`min-w-[2rem] rounded border px-2 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-violet-600 bg-violet-100 text-violet-900 dark:border-violet-500 dark:bg-violet-950/60 dark:text-violet-100'
          : 'border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700'
      }`}
      onMouseDown={(e) => {
        e.preventDefault()
        onMouseDown(e)
      }}
      onClick={(e) => e.preventDefault()}
    >
      {children}
    </button>
  )
}

export function RichTextTipTapToolbar({
  editor,
  canvasEditing = false,
}: {
  editor: Editor | null
  /**
   * Canvas inline rich-text: `inlineTipTapEditor` can be null for a frame (Strict Mode / TipTap remount)
   * while `canvasInlineEditId` is already set — still show the format bar; commands use the live store instance.
   */
  canvasEditing?: boolean
}) {
  useEffect(() => {
    richTextDebugLog('toolbar', 'RichTextTipTapToolbar editor ref', {
      hasEditor: !!editor,
      destroyed: editor?.isDestroyed,
      canvasEditing,
    })
  }, [editor, canvasEditing])

  useEffect(() => {
    if (!canvasEditing || editor) return
    const st = useEditorStore.getState()
    const raw = st.inlineTipTapEditor
    const cid = st.canvasInlineEditId
    const mapEd = cid ? activeCanvasTipTapEditorByElementId.get(cid) : undefined
    richTextDebugLog('toolbar-open', 'format bar: canvasEditing but editor prop null', {
      canvasInlineEditId: cid,
      bandCanvasEditElementId: st.bandCanvasEditElementId,
      storeInline: raw == null ? 'null' : raw.isDestroyed ? 'destroyed' : 'live',
      mapInline: mapEd == null ? 'null' : mapEd.isDestroyed ? 'destroyed' : 'live',
      mapSize: activeCanvasTipTapEditorByElementId.size,
    })
  }, [canvasEditing, editor])

  /**
   * Prefer Zustand prop when live; otherwise canvas inline reads the per-element TipTap map.
   */
  const editorForState = (() => {
    if (editor && !editor.isDestroyed) return editor
    if (!canvasEditing) return null
    const id = useEditorStore.getState().canvasInlineEditId
    const r = id ? activeCanvasTipTapEditorByElementId.get(id) : undefined
    return r && !r.isDestroyed ? r : null
  })()
  const fmt = useEditorState({
    editor: editorForState,
    selector: ({ editor: ed, transactionNumber }) => ({
      transactionNumber,
      bold: ed?.isActive('bold') ?? false,
      italic: ed?.isActive('italic') ?? false,
      underline: ed?.isActive('underline') ?? false,
      strike: ed?.isActive('strike') ?? false,
      sup: ed?.isActive('superscript') ?? false,
      sub: ed?.isActive('subscript') ?? false,
    }),
  })

  const showChrome = editor != null || canvasEditing
  if (!showChrome) {
    return (
      <div className="flex shrink-0 flex-nowrap items-center gap-1 overflow-x-auto border-b border-zinc-200 bg-zinc-50 px-1 py-1 dark:border-zinc-600 dark:bg-zinc-800/80">
        <span className="text-[10px] text-zinc-400">Opening editor…</span>
      </div>
    )
  }

  const fmtDisplay = fmt ?? INACTIVE_FMT

  return (
    <div
      className="flex shrink-0 flex-nowrap items-center gap-1 overflow-x-auto border-b border-zinc-200 bg-zinc-50 px-1 py-1 dark:border-zinc-600 dark:bg-zinc-800/80"
      data-agreemint-rich-format-toolbar
      onMouseDownCapture={toolbarMouseDownCapture}
      onMouseDown={(e) => e.preventDefault()}
      role="toolbar"
      aria-label="Text formatting"
    >
      <ToolbarBtn
        label="Bold"
        active={fmtDisplay.bold}
        onMouseDown={() =>
          execToolbarCommand(editor, 'toggleBold', (ed) => ed.chain().focus().toggleBold().run())
        }
      >
        <span className="font-bold">B</span>
      </ToolbarBtn>
      <ToolbarBtn
        label="Italic"
        active={fmtDisplay.italic}
        onMouseDown={() =>
          execToolbarCommand(editor, 'toggleItalic', (ed) => ed.chain().focus().toggleItalic().run())
        }
      >
        <span className="italic">I</span>
      </ToolbarBtn>
      <ToolbarBtn
        label="Underline"
        active={fmtDisplay.underline}
        onMouseDown={() =>
          execToolbarCommand(editor, 'toggleUnderline', (ed) => ed.chain().focus().toggleUnderline().run())
        }
      >
        <span className="underline">U</span>
      </ToolbarBtn>
      <ToolbarBtn
        label="Strikethrough"
        active={fmtDisplay.strike}
        onMouseDown={() =>
          execToolbarCommand(editor, 'toggleStrike', (ed) => ed.chain().focus().toggleStrike().run())
        }
      >
        <span className="line-through">S</span>
      </ToolbarBtn>
      <span className="hidden h-4 w-px shrink-0 bg-zinc-300 dark:bg-zinc-600 sm:block" aria-hidden />
      <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Text</span>
      <ColorToolbarSwatch
        title="Text color on selection"
        value={undefined}
        onChange={(v) => {
          execToolbarCommand(editor, 'setColor', (ed) => ed.chain().focus().setColor(v).run())
        }}
      />
      <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">HL</span>
      <ColorToolbarSwatch
        title="Highlight selection"
        value={undefined}
        onChange={(v) => {
          execToolbarCommand(editor, 'toggleHighlight', (ed) =>
            ed.chain().focus().toggleHighlight({ color: v }).run()
          )
        }}
      />
      <ToolbarBtn
        label="Superscript"
        active={fmtDisplay.sup}
        onMouseDown={() =>
          execToolbarCommand(editor, 'toggleSuperscript', (ed) =>
            ed.chain().focus().toggleSuperscript().run()
          )
        }
      >
        <span>
          x<sup className="text-[0.65em]">2</sup>
        </span>
      </ToolbarBtn>
      <ToolbarBtn
        label="Subscript"
        active={fmtDisplay.sub}
        onMouseDown={() =>
          execToolbarCommand(editor, 'toggleSubscript', (ed) => ed.chain().focus().toggleSubscript().run())
        }
      >
        <span>
          x<sub className="text-[0.65em]">2</sub>
        </span>
      </ToolbarBtn>
      <ToolbarBtn
        label="Clear formatting on selection"
        onMouseDown={() =>
          execToolbarCommand(editor, 'unsetAllMarks', (ed) => ed.chain().focus().unsetAllMarks().run())
        }
      >
        <span className="text-[10px]">Clear</span>
      </ToolbarBtn>
    </div>
  )
}
