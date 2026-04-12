import { Extension, type Editor } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import { PluginKey } from '@tiptap/pm/state'
import tippy, { type Instance as TippyInstance } from 'tippy.js'
import { Suggestion } from '@tiptap/suggestion'
import {
  VariableSuggestionList,
  type VariableSuggestItem,
} from '../components/editor/VariableSuggestionList'
import { normalizeVariableIdentifier } from './richContent'

const pluginKey = new PluginKey('agreemintVariableAt')

function getMentionItems(editor: Editor): VariableSuggestItem[] {
  return editor.storage.variableSuggestStorage?.items ?? []
}

export const VariableAtSuggestion = Extension.create({
  name: 'variableAtSuggestion',

  addProseMirrorPlugins() {
    const editor = this.editor

    return [
      Suggestion<VariableSuggestItem, VariableSuggestItem>({
        pluginKey,
        editor,
        char: '@',
        allowSpaces: false,
        allowedPrefixes: [' ', '\n'],
        command: ({ editor: ed, range, props }) => {
          const id = normalizeVariableIdentifier(props.id)
          ed.chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              { type: 'layoutVariable', attrs: { name: id } },
              { type: 'text', text: ' ' },
            ])
            .run()
        },
        items: ({ query }) => {
          const all = getMentionItems(editor)
          const q = query.toLowerCase()
          if (!q.trim()) return all.slice(0, 50)
          return all
            .filter(
              (it) =>
                it.id.toLowerCase().includes(q) ||
                it.label.toLowerCase().includes(q)
            )
            .slice(0, 50)
        },
        render: () => {
          let component: ReactRenderer | null = null
          let popup: TippyInstance | null = null

          return {
            onStart: (props) => {
              component = new ReactRenderer(VariableSuggestionList, {
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
