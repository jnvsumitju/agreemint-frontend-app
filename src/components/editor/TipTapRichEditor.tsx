import 'tippy.js/dist/tippy.css'
import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Collaboration from '@tiptap/extension-collaboration'
import type * as Y from 'yjs'
import { LayoutVariable } from '../../lib/tiptapLayoutVariable'
import { VariableSuggestStorage } from '../../lib/tiptapVariableSuggestStorage'
import { VariableAtSuggestion } from '../../lib/tiptapVariableAtSuggestion'
import { pmDocToRuns, runsToTipTapJSON } from '../../lib/tipTapRichBridge'
import type { VariableChipInfo, VariableMentionItem } from '../../lib/layoutBehaviourResolve'
import { parseContentToRuns, sanitizeLinkHref, serializeRunsToContent } from '../../lib/richContent'
import { richTextDebugLog } from '../../lib/richTextDebugLog'
export type TipTapRichEditorMode = 'panel' | 'canvas'

export interface TipTapRichEditorProps {
  content: string | undefined
  /**
   * When true (default), calls `onChange` on each doc update. While focused, the editor ignores prop
   * `content` so parent store updates do not reset the doc — use this for Properties and canvas inline.
   */
  emitOnChange?: boolean
  /** When true, editor is display-only (no typing, no emitOnChange). */
  readOnly?: boolean
  autoFocus?: boolean
  onChange: (serialized: string) => void
  variableMentions: VariableMentionItem[]
  variableValues?: Record<string, string>
  /** When set, variable chips are clickable for a scope / description / preview popover (canvas inline edit). */
  variableChipDetailResolver?: (name: string) => VariableChipInfo
  /** Chip text in editor (e.g. `Page.Customer Name` / `Global.Customer Name`); should match read-only preview. */
  variableSurfaceLabelResolver?: (name: string) => string
  mode?: TipTapRichEditorMode
  className?: string
  editorClassName?: string
  editorStyle?: CSSProperties
  placeholder?: string
  sessionKey?: string | number
  onReady?: (editor: Editor) => void
  /** Called when this editor instance is destroyed or the hook drops it (pass `ed` to avoid clearing newer siblings under Strict Mode). */
  onUnmount?: (editor: Editor) => void
  canvasKeyboard?: {
    onEscape: () => void
    onCommitShortcut: () => void
  }
  /**
   * When supplied, the editor document is backed by this Y.XmlFragment via the
   * Collaboration extension. Character-level concurrent edits merge through Yjs
   * CRDT. StarterKit's history module is disabled in this mode — Yjs owns undo.
   *
   * Seeding: if the fragment is empty on first mount, TipTap applies the initial
   * `content` prop into it once. Subsequent remotes flow via yDocProvider.
   */
  collabFragment?: Y.XmlFragment
}

function proseMirrorHasFocus(editor: Editor) {
  try {
    return editor.view.hasFocus()
  } catch {
    return false
  }
}

export function TipTapRichEditor({
  content,
  emitOnChange = true,
  readOnly = false,
  autoFocus,
  onChange,
  variableMentions,
  variableValues = {},
  variableChipDetailResolver,
  variableSurfaceLabelResolver,
  mode = 'panel',
  className,
  editorClassName,
  editorStyle,
  placeholder = 'Type @ to insert a variable…',
  sessionKey = 0,
  onReady,
  onUnmount,
  canvasKeyboard,
  collabFragment,
}: TipTapRichEditorProps) {
  const lastEmitted = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  const onReadyRef = useRef(onReady)
  const onUnmountRef = useRef(onUnmount)
  const canvasKbRef = useRef(canvasKeyboard)
  onChangeRef.current = onChange
  onReadyRef.current = onReady
  onUnmountRef.current = onUnmount
  canvasKbRef.current = canvasKeyboard

  const emitAllowedRef = useRef(emitOnChange && !readOnly)
  emitAllowedRef.current = emitOnChange && !readOnly

  /** Canvas inline: cursor at end of block. Panel: TipTap default (start) when autofocus is on. */
  const autofocusPosition =
    readOnly
      ? false
      : (autoFocus ?? mode === 'canvas')
        ? mode === 'canvas'
          ? 'end'
          : true
        : false

  const extensions = useMemo(
    () => {
      const base = [
        VariableSuggestStorage,
        LayoutVariable,
        VariableAtSuggestion,
        StarterKit.configure({
          heading: false,
          blockquote: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          codeBlock: false,
          horizontalRule: false,
          code: false,
          // Underline is included in StarterKit; do not register @tiptap/extension-underline again.
          // Yjs owns history when Collaboration is active. StarterKit 3.x renamed
          // the history module to `undoRedo` — disabling both keys covers 2.x
          // and 3.x StarterKit without a runtime warning.
          ...(collabFragment ? { history: false, undoRedo: false } : {}),
        }),
        Subscript,
        Superscript,
        TextStyle,
        Color.configure({ types: ['textStyle'] }),
        Highlight.configure({ multicolor: true }),
        // `Link` — configured with our own safe-URL validator so pasted /
        // autolinked hrefs with unsafe protocols (javascript:, data:, …) are
        // rejected before they can reach the PDF renderer. `openOnClick:false`
        // because the editor surface should never navigate away — clicks on
        // a link inside the canvas just position the caret. Variable-aware:
        // LayoutVariable chips are in `includeInlineType`s, which TipTap
        // needs to let a link mark span a variable chip.
        Link.configure({
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          protocols: ['http', 'https', 'mailto', 'tel'],
          HTMLAttributes: {
            rel: 'noopener noreferrer',
            target: '_blank',
            class: 'agreemint-link',
          },
          validate: (href: string) => sanitizeLinkHref(href) != null,
        }),
        Placeholder.configure({
          placeholder,
          emptyEditorClass: 'is-editor-empty',
        }),
      ]
      if (collabFragment) {
        base.push(Collaboration.configure({ fragment: collabFragment }))
      }
      return base
    },
    [placeholder, collabFragment]
  )

  const editor = useEditor(
    {
      extensions,
      editable: !readOnly,
      autofocus: autofocusPosition,
      content: runsToTipTapJSON(parseContentToRuns(content)),
      editorProps: {
        attributes: {
          class: [
            'ProseMirror max-w-none outline-none',
            mode === 'canvas'
              ? 'min-h-[1.25em] px-1 py-0.5'
              : 'min-h-[120px] rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600',
            editorClassName ?? '',
          ]
            .filter(Boolean)
            .join(' '),
        },
        handleDOMEvents: {
          keydown: (_view, event) => {
            const kb = canvasKbRef.current
            if (!kb) return false
            if (event.key === 'Escape') {
              event.preventDefault()
              kb.onEscape()
              return true
            }
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              kb.onCommitShortcut()
              return true
            }
            return false
          },
        },
      },
      onCreate: ({ editor: ed }) => {
        if (mode === 'canvas') {
          richTextDebugLog('tiptap', 'onCreate (no onReady here — deferred to useEffect)', {
            sessionKey,
            readOnly,
            emitOnChange,
            autofocusPosition,
            editorId: (ed as unknown as { id?: string }).id,
          })
        }
      },
      onUpdate: ({ editor: ed }) => {
        if (readOnly || !emitAllowedRef.current) {
          if (mode === 'canvas') {
            richTextDebugLog('tiptap', 'onUpdate skipped', {
              sessionKey,
              readOnly,
              emitAllowed: emitAllowedRef.current,
            })
          }
          return
        }
        const serialized = serializeRunsToContent(pmDocToRuns(ed.state.doc))
        lastEmitted.current = serialized
        if (mode === 'canvas') {
          const { from, to, empty } = ed.state.selection
          richTextDebugLog('tiptap', 'onUpdate emit', {
            sessionKey,
            len: serialized.length,
            preview: serialized.slice(0, 80),
            selection: { from, to, empty },
          })
        }
        onChangeRef.current(serialized)
      },
    },
    [extensions, sessionKey, mode, editorClassName, emitOnChange, autoFocus, readOnly, autofocusPosition]
  )

  /**
   * Register the editor via `onReady` only from useEffect — NOT from `onCreate`.
   * `useState` initializer runs twice in Strict Mode dev; each call creates a real TipTap
   * `Editor` and fires `onCreate` synchronously, but React discards the second. If `onReady`
   * runs from `onCreate`, the discarded editor overwrites the live one in the store/map.
   * `useEditor` returns the editor React actually kept, so registering here is safe.
   */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (mode === 'canvas') {
      richTextDebugLog('tiptap', 'useEffect onReady (editor from useEditor)', {
        sessionKey,
        isDestroyed: editor.isDestroyed,
      })
    }
    onReadyRef.current?.(editor)
  }, [editor, sessionKey, mode])

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  useEffect(() => {
    if (!editor) return
    const ed = editor
    const onDestroy = () => {
      onUnmountRef.current?.(ed)
    }
    ed.on('destroy', onDestroy)
    return () => {
      ed.off('destroy', onDestroy)
      onUnmountRef.current?.(ed)
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const s = editor.storage.variableSuggestStorage
    s.items = variableMentions
    s.previewValues = variableValues
    if (variableChipDetailResolver) {
      s.chipDetailEnabled = true
      s.resolveChipInfo = variableChipDetailResolver
    } else {
      s.chipDetailEnabled = false
      s.resolveChipInfo = null
    }
    s.resolveSurfaceLabel = variableSurfaceLabelResolver ?? null
  }, [editor, variableMentions, variableValues, variableChipDetailResolver, variableSurfaceLabelResolver])

  useEffect(() => {
    if (!editor) return
    // Do not overwrite the doc from props while the user is typing (prop can lag one frame).
    const typing =
      emitOnChange && !readOnly && (editor.isFocused || proseMirrorHasFocus(editor))
    if (typing) return

    const incoming = content ?? ''
    if (emitOnChange && !readOnly) {
      if (incoming === lastEmitted.current) {
        if (mode === 'canvas') {
          richTextDebugLog('tiptap-sync', 'skip incoming===lastEmitted', { sessionKey })
        }
        return
      }
    }
    const local = serializeRunsToContent(pmDocToRuns(editor.state.doc))
    if (incoming === local) {
      if (mode === 'canvas') {
        richTextDebugLog('tiptap-sync', 'skip incoming===local', { sessionKey })
      }
      return
    }
    if (
      mode === 'canvas' &&
      emitOnChange &&
      !readOnly &&
      lastEmitted.current != null &&
      local === lastEmitted.current &&
      incoming !== local
    ) {
      richTextDebugLog('tiptap-sync', 'skip canvas stale-incoming guard', {
        sessionKey,
        localLen: local.length,
        incomingLen: incoming.length,
        localPreview: local.slice(0, 60),
        incomingPreview: incoming.slice(0, 60),
      })
      return
    }
    const docContent = content
    if (mode === 'canvas') {
      richTextDebugLog('tiptap-sync', 'queueMicrotask setContent path', {
        sessionKey,
        incomingLen: incoming.length,
        localLen: local.length,
      })
    }
    // Defer setContent so TipTap React node views do not call flushSync during React passive effects.
    queueMicrotask(() => {
      const ed = editor
      if (!ed || ed.isDestroyed) {
        if (mode === 'canvas') {
          richTextDebugLog('tiptap-sync', 'microtask abort destroyed', { sessionKey })
        }
        return
      }
      if (emitOnChange && !readOnly && (ed.isFocused || proseMirrorHasFocus(ed))) {
        if (mode === 'canvas') {
          richTextDebugLog('tiptap-sync', 'microtask skip editor focused', { sessionKey })
        }
        return
      }
      const inc = docContent ?? ''
      if (emitOnChange && !readOnly && inc === lastEmitted.current) {
        if (mode === 'canvas') {
          richTextDebugLog('tiptap-sync', 'microtask skip inc===lastEmitted', { sessionKey })
        }
        return
      }
      const loc = serializeRunsToContent(pmDocToRuns(ed.state.doc))
      if (inc === loc) {
        if (mode === 'canvas') {
          richTextDebugLog('tiptap-sync', 'microtask skip inc===loc', { sessionKey })
        }
        return
      }
      if (
        mode === 'canvas' &&
        emitOnChange &&
        !readOnly &&
        lastEmitted.current != null &&
        loc === lastEmitted.current &&
        inc !== loc
      ) {
        richTextDebugLog('tiptap-sync', 'microtask skip canvas stale-incoming guard', {
          sessionKey,
          incLen: inc.length,
          locLen: loc.length,
        })
        return
      }
      if (mode === 'canvas') {
        richTextDebugLog('tiptap-sync', 'microtask setContent APPLY', {
          sessionKey,
          incLen: inc.length,
        })
      }
      ed.commands.setContent(runsToTipTapJSON(parseContentToRuns(docContent)), { emitUpdate: false })
    })
  }, [content, editor, emitOnChange, readOnly, sessionKey, mode])

  if (!editor) {
    return <div className={className} style={editorStyle} aria-hidden />
  }

  return (
    <div className={className} style={editorStyle} data-agreemint-tiptap-root>
      <EditorContent editor={editor} />
    </div>
  )
}
