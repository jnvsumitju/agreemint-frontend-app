import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import { PluginKey } from '@tiptap/pm/state'
import tippy, { type Instance as TippyInstance } from 'tippy.js'
import { Suggestion } from '@tiptap/suggestion'
import {
  SlashSymbolSuggestionList,
  type SlashSymbolItem,
} from '../components/editor/SlashSymbolSuggestionList'
import { EMOJI_SYMBOLS, MATH_SYMBOLS } from './symbolCatalog'

/**
 * Slash-command suggestion plugin — typing {@code /} inside an inline-
 * editing TipTap textbox opens a typeahead menu of math symbols + emojis.
 * Mirrors the existing {@code @variable} mention plugin so two parallel
 * trigger characters can coexist on the same editor instance.
 *
 * <p>On selection the plugin replaces the {@code /…query} text with the
 * chosen Unicode glyph — no separate popover, no element creation. This
 * makes the slash flow the fastest of the three insert paths (palette
 * tile, FormatBar button, slash menu).
 */
const pluginKey = new PluginKey('agreemintSlashSymbol')

const MATH_ITEMS: SlashSymbolItem[] = MATH_SYMBOLS.map((s) => ({
  id: `math-${s.char}-${s.label}`,
  char: s.char,
  label: s.label,
  category: `Math · ${s.category}`,
  isMath: true,
}))

const EMOJI_ITEMS: SlashSymbolItem[] = EMOJI_SYMBOLS.map((s) => ({
  id: `emoji-${s.char}-${s.label}`,
  char: s.char,
  label: s.label,
  category: `Emoji · ${s.category}`,
  isMath: false,
}))

const ALL_ITEMS: SlashSymbolItem[] = [...MATH_ITEMS, ...EMOJI_ITEMS]

export const SlashSymbolSuggestion = Extension.create({
  name: 'slashSymbolSuggestion',

  addProseMirrorPlugins() {
    const editor = this.editor

    return [
      Suggestion<SlashSymbolItem, SlashSymbolItem>({
        pluginKey,
        editor,
        char: '/',
        // Slash mid-word would fire on URLs and date strings — restrict
        // the trigger to the start of a line or after whitespace.
        allowedPrefixes: [' ', '\n'],
        allowSpaces: false,
        command: ({ editor: ed, range, props }) => {
          ed.chain()
            .focus()
            .deleteRange(range)
            .insertContent(props.char)
            .run()
        },
        items: ({ query }) => {
          const q = query.trim().toLowerCase()
          if (!q) {
            // Empty query: show a balanced starter set so authors see
            // BOTH math and emoji on first open. A flat slice of
            // ALL_ITEMS would only ever surface math glyphs (since
            // MATH_ITEMS has ~139 entries and comes first in the
            // concatenated array, the first 50 would all be math).
            return [...MATH_ITEMS.slice(0, 30), ...EMOJI_ITEMS.slice(0, 30)]
          }
          // Match label OR the glyph itself (so typing "/π" works for
          // anyone with a Unicode-friendly keyboard).
          return ALL_ITEMS
            .filter(
              (it) =>
                it.label.toLowerCase().includes(q) || it.char === query,
            )
            .slice(0, 60)
        },
        render: () => {
          let component: ReactRenderer | null = null
          let popup: TippyInstance | null = null
          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashSymbolSuggestionList, {
                props,
                editor: props.editor,
              })
              if (!props.clientRect) return
              popup = tippy(document.body, {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
                zIndex: 99999,
              })
            },
            onUpdate(props) {
              component?.updateProps(props)
              popup?.setProps({
                getReferenceClientRect: props.clientRect as () => DOMRect,
              })
            },
            onKeyDown(props) {
              if (props.event.key === 'Escape') {
                popup?.hide()
                return true
              }
              return false
            },
            onExit() {
              popup?.destroy()
              popup = null
              component?.destroy()
              component = null
            },
          }
        },
      }),
    ]
  },
})
