import { Extension } from '@tiptap/core'
import type { VariableChipInfo, VariableMentionItem } from './layoutBehaviourResolve'

declare module '@tiptap/core' {
  interface Storage {
    variableSuggestStorage: {
      items: VariableMentionItem[]
      previewValues: Record<string, string>
      chipDetailEnabled: boolean
      resolveChipInfo: ((name: string) => VariableChipInfo) | null
      resolveSurfaceLabel: ((name: string) => string) | null
    }
  }
}

/** Holds @-mention items, preview strings, and optional variable-chip detail resolver. */
export const VariableSuggestStorage = Extension.create({
  name: 'variableSuggestStorage',
  addStorage() {
    return {
      items: [] as VariableMentionItem[],
      previewValues: {} as Record<string, string>,
      chipDetailEnabled: false,
      resolveChipInfo: null as ((name: string) => VariableChipInfo) | null,
      resolveSurfaceLabel: null as ((name: string) => string) | null,
    }
  },
})
