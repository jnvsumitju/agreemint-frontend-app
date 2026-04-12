import { useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { VariableChipInfo, VariableMentionItem } from '../../lib/layoutBehaviourResolve'
import { TipTapRichEditor } from './TipTapRichEditor'
import { RichTextTipTapToolbar } from './RichTextTipTapToolbar'

interface RichContentEditorProps {
  content: string | undefined
  onChange: (serialized: string) => void
  variableMentions: VariableMentionItem[]
  variableValues?: Record<string, string>
  variableChipDetailResolver?: (name: string) => VariableChipInfo
  variableSurfaceLabelResolver?: (name: string) => string
  /** Mirror canvas inline edit without a second writable editor. */
  readOnly?: boolean
  sessionKey?: string | number
}

export function RichContentEditor({
  content,
  onChange,
  variableMentions,
  variableValues = {},
  variableChipDetailResolver,
  variableSurfaceLabelResolver,
  readOnly = false,
  sessionKey,
}: RichContentEditorProps) {
  const [panelEditor, setPanelEditor] = useState<Editor | null>(null)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
        Rich text with bold, italic, underline, strikethrough, super/subscript, colors, and variables.
        Type <kbd className="rounded border border-zinc-300 px-0.5 font-mono dark:border-zinc-600">@</kbd>{' '}
        to pick a merge field. If a global and a page-local field share the same name, the list shows two
        choices; the page-local token uses the <code className="font-mono text-[10px]">_page.</code>{' '}
        prefix (see Variables tab).
      </p>
      {readOnly ? (
        <p className="text-[10px] font-medium text-amber-800 dark:text-amber-200">
          This block is open on the canvas — finish there or press Escape on the page to avoid conflicting
          edits.
        </p>
      ) : null}
      {!readOnly ? <RichTextTipTapToolbar editor={panelEditor} /> : null}
      <TipTapRichEditor
        content={content}
        onChange={onChange}
        variableMentions={variableMentions}
        variableValues={variableValues}
        variableChipDetailResolver={variableChipDetailResolver}
        variableSurfaceLabelResolver={variableSurfaceLabelResolver}
        readOnly={readOnly}
        emitOnChange={!readOnly}
        sessionKey={sessionKey ?? 'rich-panel'}
        placeholder="Type @ to insert a variable…"
        onReady={(ed) => setPanelEditor(ed)}
        onUnmount={(ed) => setPanelEditor((prev) => (prev === ed ? null : prev))}
      />
    </div>
  )
}
