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
import {
  isEffectivelyEmptyRichContent,
  parseContentToRuns,
  sanitizeLinkHref,
  serializeRunsToContent,
} from '../../lib/richContent'
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
   * Called once for each paste event into the editor. The canvas uses this
   * signal to schedule a backend-driven reflow on commit (the FE reflow is
   * a fast approximation; iText is the source of truth for split points).
   */
  onPaste?: () => void
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
  onPaste,
}: TipTapRichEditorProps) {
  const lastEmitted = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  const onReadyRef = useRef(onReady)
  const onUnmountRef = useRef(onUnmount)
  const canvasKbRef = useRef(canvasKeyboard)
  const onPasteRef = useRef(onPaste)
  onChangeRef.current = onChange
  onReadyRef.current = onReady
  onUnmountRef.current = onUnmount
  canvasKbRef.current = canvasKeyboard
  onPasteRef.current = onPaste

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
          // TipTap 3 splits URL validation into two hooks: `validate` runs
          // on autolink / paste-detected URLs, while `isAllowedUri` is the
          // gate for explicit `setLink()` calls. Earlier we only supplied
          // `validate`, so `setLink` silently fell back to the built-in
          // loose permission check. Configuring both against our single
          // sanitiser keeps all code paths consistent and prevents a safe
          // URL from being refused by setLink in some edge case.
          validate: (href: string) => sanitizeLinkHref(href) != null,
          isAllowedUri: (href: string) => sanitizeLinkHref(href) != null,
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
            // Canvas mode: no padding. The ProseMirror box must sit at the
            // exact same origin as `ElementPreview`'s box so double-clicking
            // into edit mode doesn't visually shift the text. Keeping a
            // minimum height ensures there's always a hit target + caret.
            mode === 'canvas'
              ? 'min-h-[1.25em]'
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
        // Notify the parent that a paste happened — used by the canvas to
        // schedule a backend reflow on commit. Returning false lets TipTap's
        // default paste handling proceed (we only want to observe).
        handlePaste: () => {
          onPasteRef.current?.()
          return false
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

  /**
   * Mount-time content reconciliation (Google-Docs / Figma-style).
   *
   * TipTap's `Collaboration` extension treats the Y.XmlFragment as source
   * of truth on mount: if the fragment has ANY child nodes, the PM doc is
   * rebuilt from the fragment and the `content` prop is ignored. That's
   * correct in principle — but it means a previously-seeded fragment that
   * contains just an empty paragraph (which is what you get when an
   * element was first edited with no typed content) will "win" on every
   * later mount and silently blank out a store that does have content.
   *
   * This effect runs exactly once per editor instance and reconciles:
   *   • If the Y fragment resolves to effectively-empty content AND the
   *     store's `content` prop has real content, apply `content` to the
   *     editor. Because Collaboration is watching, the setContent goes
   *     through to the fragment too — the next mount will find the
   *     fragment populated and this effect is a no-op.
   *   • Otherwise trust whatever is currently in the PM doc (which is
   *     already the fragment's content).
   *
   * `emitUpdate: true` so downstream listeners (`persistCanvasTextContent`)
   * mirror the reconciled doc into the store.
   */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    // Only reconcile when Yjs is active — for non-collab mode the normal
    // content-sync effect below already handles the store-→-doc flow.
    if (!collabFragment) return
    const pmSerialized = serializeRunsToContent(pmDocToRuns(editor.state.doc))
    const incoming = content ?? ''
    if (
      isEffectivelyEmptyRichContent(pmSerialized) &&
      !isEffectivelyEmptyRichContent(incoming)
    ) {
      richTextDebugLog('tiptap-reconcile', 'seeding empty Yjs fragment from store content', {
        sessionKey,
        incomingLen: incoming.length,
      })
      // Defer to the microtask queue so this doesn't run inside the
      // React commit phase (TipTap's nodeViews can call flushSync during
      // setContent which conflicts with passive effects).
      queueMicrotask(() => {
        if (!editor || editor.isDestroyed) return
        editor.commands.setContent(runsToTipTapJSON(parseContentToRuns(incoming)), {
          emitUpdate: true,
        })
        lastEmitted.current = incoming
      })
    }
    // Intentionally only runs when editor identity changes — once per
    // mount. We don't want to re-seed on every content-prop change (the
    // other sync effect handles that path with all its staleness guards).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

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
    // Do not overwrite the doc from props while the user is typing (prop
    // can lag one frame). Exception: on the very first run after mount
    // (`lastEmitted.current === null`) autofocus makes the editor
    // "focused" before the user has actually typed anything, so treating
    // it as "typing" here locks the initial content sync out. Allow the
    // first invocation through — `lastEmitted` will be populated as soon
    // as the sync applies or the user types a character, after which
    // this guard starts behaving normally for subsequent prop churn.
    const typing =
      emitOnChange && !readOnly && (editor.isFocused || proseMirrorHasFocus(editor))
    if (typing && lastEmitted.current != null) return

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
    // ── Yjs-first content guard ──────────────────────────────────────────
    // When Collaboration is active, the Y.XmlFragment is the source of
    // truth and TipTap seeds the PM doc from it on mount. The store's
    // `content` prop is a DERIVED mirror that can lag (or be transiently
    // wiped by a stale remote op, a snapshot clobber, etc.). If the prop
    // is effectively empty but the Yjs-backed PM doc has real content,
    // applying the prop via `setContent("")` would wipe the fragment,
    // which then fans out to every other replica — exactly the
    // "double-click shows empty text" bug. Skip in that case.
    if (
      collabFragment &&
      isEffectivelyEmptyRichContent(incoming) &&
      !isEffectivelyEmptyRichContent(local)
    ) {
      if (mode === 'canvas') {
        richTextDebugLog('tiptap-sync', 'skip empty-incoming-with-yjs', {
          sessionKey,
          localLen: local.length,
        })
      }
      // Seed `lastEmitted` with the Yjs-backed value so the next incoming
      // prop (which will mirror it on the next onUpdate tick) is treated
      // as "same as local" and exits the effect cleanly.
      lastEmitted.current = local
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
      // Re-check the Yjs-first guard inside the microtask too — the PM doc
      // may have gained content between the outer effect and this point
      // (Yjs state replay, remote update, etc.).
      if (
        collabFragment &&
        isEffectivelyEmptyRichContent(inc) &&
        !isEffectivelyEmptyRichContent(loc)
      ) {
        if (mode === 'canvas') {
          richTextDebugLog('tiptap-sync', 'microtask skip empty-incoming-with-yjs', {
            sessionKey,
            locLen: loc.length,
          })
        }
        lastEmitted.current = loc
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
  }, [content, editor, emitOnChange, readOnly, sessionKey, mode, collabFragment])

  if (!editor) {
    return <div className={className} style={editorStyle} aria-hidden />
  }

  return (
    <div className={className} style={editorStyle} data-agreemint-tiptap-root>
      <EditorContent editor={editor} />
    </div>
  )
}
