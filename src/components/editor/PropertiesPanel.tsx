import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { findElementByIdInDocumentDeep } from '../../lib/bandNestedLayout'
import { documentBandElementsFromFirstPage, findElementByIdInDocument } from '../../lib/documentPageMerge'
import {
  primarySelectedId,
  selectActivePageElements,
  useEditorStore,
} from '../../stores/editorStore'
import {
  availableVariableMentionsForMentionSuggest,
  resolveVariableChipInfo,
  variableMergeFieldSurfaceLabel,
} from '../../lib/layoutBehaviourResolve'
import { isColumnHighlighted } from '../../types/tableSelection'
import type { ElementStyle, LayoutElement } from '../../types/layout'
import { LABEL_CLASS, DELETE_LINK_CLASS } from './uiClasses'
import { FieldInput } from './ui/FieldInput'
import { FieldSelect } from './ui/FieldSelect'
import { FieldCheckbox } from './ui/FieldCheckbox'
import { ActionButton } from './ui/ActionButton'
import {
  coerceLayoutScalar,
  isRichTextElement,
  normalizeColumnWidths,
} from '../../types/layout'
import { defaultSampleListItemsJson, normalizeVariableIdentifier } from '../../lib/variables'
import type { ListStyle } from '../../types/layout'
import { buildListTree, flattenListTree } from '../../types/layout'
import {
  buildInitialStructuredData,
  parseTableVariableData,
  seedCellStyleFromCanvasMaps,
  serializeTableVariableData,
} from '../../lib/tableDataFormat'
import { tablePreviewBodyRowCount } from '../../lib/tablePreview'
import { VariablesSection } from './VariablesSection'
import { LayersSection } from './LayersSection'
import { HistoryPanel } from './HistoryPanel'
import { CommentsPanel } from './CommentsPanel'
import { ActivityTab } from './ActivityTab'
import { RichContentEditor } from './RichContentEditor'
import {
  BoxAppearanceFields,
  RichTextAppearanceFields,
  StrokeColorField,
  TableTextColorField,
  ElementVisualFields,
  BorderStyleFields,
} from './elementAppearanceFields'
import { FONT_LIST, loadFont } from '../../lib/fontLoader'
import { ElementBehaviourEditor } from './ElementBehaviourEditor'
import { DocumentPageSection } from './DocumentPageSection'
import { MultiSelectionPanel } from './MultiSelectionPanel'

function useVariableMentionLists() {
  const bandEditorMode = useEditorStore((s) => s.bandCanvasEditElementId != null)
  const pages = useEditorStore((s) => s.pages)
  const activePageIndex = useEditorStore((s) => s.activePageIndex)
  const globalVariableDefinitions = useEditorStore((s) => s.globalVariableDefinitions)
  const variableValues = useEditorStore((s) => s.variableValues)
  const pagesForSuggest = useMemo(
    () => (bandEditorMode ? pages.map((p) => ({ ...p, localVariables: undefined })) : pages),
    [bandEditorMode, pages]
  )
  const suggestPageIndex = bandEditorMode ? 0 : activePageIndex
  const variableMentionItems = useMemo(
    () =>
      availableVariableMentionsForMentionSuggest(
        globalVariableDefinitions,
        pagesForSuggest,
        suggestPageIndex,
        variableValues
      ),
    [globalVariableDefinitions, pagesForSuggest, suggestPageIndex, variableValues]
  )
  const variableKeyOptions = useMemo(
    () => [...new Set(variableMentionItems.map((m) => m.id))].sort(),
    [variableMentionItems]
  )
  const resolveVariableChipDetail = useCallback(
    (name: string) =>
      resolveVariableChipInfo(
        name,
        globalVariableDefinitions,
        pagesForSuggest[suggestPageIndex],
        variableValues
      ),
    [globalVariableDefinitions, pagesForSuggest, suggestPageIndex, variableValues]
  )
  const resolveVariableSurfaceLabel = useCallback(
    (name: string) =>
      variableMergeFieldSurfaceLabel(name, globalVariableDefinitions, pagesForSuggest[suggestPageIndex]),
    [globalVariableDefinitions, pagesForSuggest, suggestPageIndex]
  )
  return { variableMentionItems, variableKeyOptions, resolveVariableChipDetail, resolveVariableSurfaceLabel }
}

function StyleFields({
  style,
  onChange,
}: {
  style: ElementStyle | undefined
  onChange: (s: ElementStyle) => void
}) {
  const s = style ?? {}
  return (
    <div className="flex flex-col gap-2">
      <FieldSelect
        label="Font family"
        id="ag-editor-style-font-family"
        value={s.fontFamily ?? ''}
        onChange={(e) => {
          const v = e.target.value
          if (v) {
            loadFont(v)
            onChange({ ...s, fontFamily: v })
          } else {
            const rest = { ...s }
            delete rest.fontFamily
            onChange(rest)
          }
        }}
        options={[
          { value: '', label: 'Default' },
          ...FONT_LIST.map((f) => ({ value: f.family, label: f.family })),
        ]}
      />
      <FieldInput
        label="Font size"
        id="ag-editor-style-font-size"
        type="number"
        value={s.fontSize ?? 12}
        onChange={(e) => onChange({ ...s, fontSize: Number(e.target.value) || 12 })}
      />
      <FieldInput
        label="Line height"
        id="ag-editor-style-line-height"
        type="number"
        step={0.1}
        value={s.lineHeight ?? 1.4}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v) && v >= 0.5 && v <= 5) onChange({ ...s, lineHeight: Math.round(v * 10) / 10 })
        }}
      />
      <FieldCheckbox
        label="Bold"
        id="ag-editor-style-bold"
        checked={!!s.bold}
        onChange={(e) => onChange({ ...s, bold: e.target.checked })}
      />
      <FieldCheckbox
        label="Italic"
        id="ag-editor-style-italic"
        checked={!!s.italic}
        onChange={(e) => onChange({ ...s, italic: e.target.checked })}
      />
      <FieldSelect
        label="Alignment"
        id="ag-editor-style-align"
        value={s.align ?? 'left'}
        onChange={(e) => onChange({ ...s, align: e.target.value as ElementStyle['align'] })}
        options={[
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Center' },
          { value: 'right', label: 'Right' },
        ]}
      />
      <RichTextAppearanceFields style={s} onChange={onChange} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  TABLE — Loop / Data Key / Global toggle                            */
/* ------------------------------------------------------------------ */

function TableDataSection({ el, patch }: { el: LayoutElement; patch: (p: Partial<LayoutElement>) => void }) {
  const globalDefs = useEditorStore((s) => s.globalVariableDefinitions)
  const setGlobalDefs = useEditorStore((s) => s.setGlobalVariableDefinitions)
  const pages = useEditorStore((s) => s.pages)
  const activePageIndex = useEditorStore((s) => s.activePageIndex)
  const setPageLocalDefs = useEditorStore((s) => s.setPageLocalVariableDefinitions)
  const setVariableValue = useEditorStore((s) => s.setVariableValue)

  const activePage = pages[activePageIndex]
  const localDefs = activePage?.localVariables ?? []
  const loopEnabled = !!el.dataKey
  const dataKey = el.dataKey ?? ''

  const isGlobal = globalDefs.some((d) => d.key === dataKey)

  const allKeys = new Set([
    ...globalDefs.map((d) => d.key),
    ...localDefs.map((d) => d.key),
  ])

  const generateUniqueKey = () => {
    let base = 'table_data'
    if (!allKeys.has(base)) return base
    let n = 2
    while (allKeys.has(`${base}_${n}`)) n++
    return `${base}_${n}`
  }

  /** Read latest state from store to avoid stale closures (critical for blur handlers). */
  const addVarDef = (key: string, global: boolean) => {
    const def = { key, description: 'Table data' }
    const s = useEditorStore.getState()
    const gd = s.globalVariableDefinitions
    const pg = s.pages[s.activePageIndex]
    const ld = pg?.localVariables ?? []
    if (global) {
      if (!gd.some((d) => d.key === key)) setGlobalDefs([...gd, def])
    } else {
      if (!ld.some((d) => d.key === key)) {
        setPageLocalDefs(pg?.id ?? activePage.id, [...ld, def])
      }
    }
  }

  const removeVarDef = (key: string) => {
    const s = useEditorStore.getState()
    const gd = s.globalVariableDefinitions
    const pg = s.pages[s.activePageIndex]
    const ld = pg?.localVariables ?? []
    setGlobalDefs(gd.filter((d) => d.key !== key))
    setPageLocalDefs(pg?.id ?? activePage.id, ld.filter((d) => d.key !== key))
  }

  const handleLoopToggle = (checked: boolean) => {
    if (checked) {
      const key = generateUniqueKey()
      const columns = el.columns ?? []
      const bodyRows = tablePreviewBodyRowCount(el)
      const tvd = buildInitialStructuredData(columns, bodyRows)
      patch({ dataKey: key })
      addVarDef(key, true)
      setVariableValue(key, serializeTableVariableData(tvd))
    } else {
      if (dataKey) removeVarDef(dataKey)
      patch({ dataKey: undefined, tableStyleFromVariable: undefined })
    }
  }

  const handleGlobalToggle = (checked: boolean) => {
    const key = committedKeyRef.current || dataKey
    if (!key) return
    removeVarDef(key)
    addVarDef(key, checked)
  }

  // Track local input value; only commit variable definition + element patch on blur.
  // Do NOT patch el.dataKey during typing — that would cause committedKeyRef to go stale.
  const [localKey, setLocalKey] = useState(dataKey)
  const committedKeyRef = useRef(dataKey)

  // Sync when the element changes externally (e.g. different table selected, loop toggled)
  useEffect(() => {
    setLocalKey(dataKey)
    committedKeyRef.current = dataKey
  }, [dataKey])

  const handleKeyInput = (raw: string) => {
    const next = normalizeVariableIdentifier(raw)
    setLocalKey(next || '')
    // Do NOT call patch() here — only update local display. Commit on blur.
  }

  const handleKeyBlur = () => {
    const next = localKey
    const prev = committedKeyRef.current
    if (!next) {
      // Empty → revert to committed
      setLocalKey(prev)
      return
    }
    if (next === prev) return
    // Read latest state to avoid stale closures
    const s = useEditorStore.getState()
    const currentGlobalDefs = s.globalVariableDefinitions
    const currentLocalDefs = s.pages[s.activePageIndex]?.localVariables ?? []
    const currentAllKeys = new Set([
      ...currentGlobalDefs.map((d) => d.key),
      ...currentLocalDefs.map((d) => d.key),
    ])
    // Exclude prev key from collision check (we're renaming from prev → next)
    currentAllKeys.delete(prev)
    if (currentAllKeys.has(next)) {
      // Key collision — revert
      setLocalKey(prev)
      return
    }
    // Commit: update element, rename variable definition, move value
    const wasGlobal = currentGlobalDefs.some((d) => d.key === prev)
    if (prev) removeVarDef(prev)
    patch({ dataKey: next })
    addVarDef(next, wasGlobal)
    const oldVal = s.variableValues[prev]
    if (oldVal != null) {
      setVariableValue(next, oldVal)
    }
    committedKeyRef.current = next
  }

  const handleTableStyleToggle = (checked: boolean) => {
    if (checked) {
      patch({ tableStyleFromVariable: true })
      if (dataKey) {
        const raw = useEditorStore.getState().variableValues[dataKey]
        const parsed = parseTableVariableData(raw)
        if (parsed) {
          // Seed cellStyle from canvas background maps (all-null if no backgrounds set)
          const cellStyle = seedCellStyleFromCanvasMaps(
            parsed.data,
            el.tableRowBackgrounds,
            el.tableColumnBackgrounds,
            el.tableCellBackgrounds
          )
          const updated = {
            ...parsed,
            cellStyle,
            borderStyle: parsed.borderStyle ?? { width: 1, color: '#e5e7eb', style: 'solid' as const },
          }
          setVariableValue(dataKey, serializeTableVariableData(updated))
        }
      }
    } else {
      patch({ tableStyleFromVariable: undefined })
      // Strip cellStyle and borderStyle from the variable — keep only data
      if (dataKey) {
        const raw = useEditorStore.getState().variableValues[dataKey]
        const parsed = parseTableVariableData(raw)
        if (parsed) {
          setVariableValue(dataKey, serializeTableVariableData({ data: parsed.data }))
        }
      }
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-600">
      <FieldCheckbox
        label="Loop (bind to data array)"
        id={`ag-beh-table-loop-${el.id}`}
        checked={loopEnabled}
        onChange={(e) => handleLoopToggle(e.target.checked)}
      />
      {loopEnabled && (
        <>
          <FieldInput
            label="Data key"
            id={`ag-beh-table-datakey-${el.id}`}
            mono
            value={localKey}
            onChange={(e) => handleKeyInput(e.target.value)}
            onBlur={handleKeyBlur}
            placeholder="table_data"
          />
          <FieldCheckbox
            label="Global variable (available on all pages)"
            id={`ag-beh-table-global-${el.id}`}
            checked={isGlobal}
            onChange={(e) => handleGlobalToggle(e.target.checked)}
          />
          <FieldCheckbox
            label="Enable table style (styles from variable data)"
            id={`ag-beh-table-style-var-${el.id}`}
            checked={!!el.tableStyleFromVariable}
            onChange={(e) => handleTableStyleToggle(e.target.checked)}
          />
          <p className="text-[8px] leading-snug text-zinc-500 lg:text-[10px] dark:text-zinc-400">
            Data is stored as a structured object with{' '}
            <code className="rounded bg-zinc-100 px-0.5 font-mono text-[8px] lg:text-[9px] dark:bg-zinc-700">data</code>{' '}
            (2D array including headers),{' '}
            <code className="rounded bg-zinc-100 px-0.5 font-mono text-[8px] lg:text-[9px] dark:bg-zinc-700">cellStyle</code>, and{' '}
            <code className="rounded bg-zinc-100 px-0.5 font-mono text-[8px] lg:text-[9px] dark:bg-zinc-700">borderStyle</code>.
            {el.tableStyleFromVariable
              ? ' Cell styles are read from the variable data.'
              : ' Cell styles use canvas-set values.'}
          </p>
        </>
      )}
    </div>
  )
}

function ListDataSection({ el, patch }: { el: LayoutElement; patch: (p: Partial<LayoutElement>) => void }) {
  const globalDefs = useEditorStore((s) => s.globalVariableDefinitions)
  const setGlobalDefs = useEditorStore((s) => s.setGlobalVariableDefinitions)
  const pages = useEditorStore((s) => s.pages)
  const activePageIndex = useEditorStore((s) => s.activePageIndex)
  const setPageLocalDefs = useEditorStore((s) => s.setPageLocalVariableDefinitions)
  const setVariableValue = useEditorStore((s) => s.setVariableValue)

  const activePage = pages[activePageIndex]
  const localDefs = activePage?.localVariables ?? []
  const loopEnabled = !!el.dataKey
  const dataKey = el.dataKey ?? ''
  const isGlobal = globalDefs.some((d) => d.key === dataKey)

  const allKeys = new Set([
    ...globalDefs.map((d) => d.key),
    ...localDefs.map((d) => d.key),
  ])

  const generateUniqueKey = () => {
    let base = 'list_data'
    if (!allKeys.has(base)) return base
    let n = 2
    while (allKeys.has(`${base}_${n}`)) n++
    return `${base}_${n}`
  }

  const addVarDef = (key: string, global: boolean) => {
    const def = { key, description: 'List data' }
    const s = useEditorStore.getState()
    const gd = s.globalVariableDefinitions
    const pg = s.pages[s.activePageIndex]
    const ld = pg?.localVariables ?? []
    if (global) {
      if (!gd.some((d) => d.key === key)) setGlobalDefs([...gd, def])
    } else {
      if (!ld.some((d) => d.key === key)) {
        setPageLocalDefs(pg?.id ?? activePage.id, [...ld, def])
      }
    }
  }

  const removeVarDef = (key: string) => {
    const s = useEditorStore.getState()
    const gd = s.globalVariableDefinitions
    const pg = s.pages[s.activePageIndex]
    const ld = pg?.localVariables ?? []
    setGlobalDefs(gd.filter((d) => d.key !== key))
    setPageLocalDefs(pg?.id ?? activePage.id, ld.filter((d) => d.key !== key))
  }

  const handleLoopToggle = (checked: boolean) => {
    if (checked) {
      const key = generateUniqueKey()
      patch({ dataKey: key, content: '{{.}}' })
      addVarDef(key, true)
      setVariableValue(key, defaultSampleListItemsJson())
    } else {
      if (dataKey) removeVarDef(dataKey)
      patch({ dataKey: undefined, content: undefined })
    }
  }

  const handleGlobalToggle = (checked: boolean) => {
    const key = committedKeyRef.current || dataKey
    if (!key) return
    removeVarDef(key)
    addVarDef(key, checked)
  }

  const [localKey, setLocalKey] = useState(dataKey)
  const committedKeyRef = useRef(dataKey)

  useEffect(() => {
    setLocalKey(dataKey)
    committedKeyRef.current = dataKey
  }, [dataKey])

  const handleKeyInput = (raw: string) => {
    setLocalKey(normalizeVariableIdentifier(raw) || '')
  }

  const handleKeyBlur = () => {
    const next = localKey
    const prev = committedKeyRef.current
    if (!next) { setLocalKey(prev); return }
    if (next === prev) return
    const s = useEditorStore.getState()
    const gd = s.globalVariableDefinitions
    const ld = s.pages[s.activePageIndex]?.localVariables ?? []
    const allK = new Set([...gd.map((d) => d.key), ...ld.map((d) => d.key)])
    allK.delete(prev)
    if (allK.has(next)) { setLocalKey(prev); return }
    const wasGlobal = gd.some((d) => d.key === prev)
    if (prev) removeVarDef(prev)
    patch({ dataKey: next })
    addVarDef(next, wasGlobal)
    const oldVal = s.variableValues[prev]
    if (oldVal != null) setVariableValue(next, oldVal)
    committedKeyRef.current = next
  }

  // Static item helpers — flatten tree for UI, rebuild on change
  const flatItems = useMemo(() => {
    if (!el.listItems?.length) return { texts: [] as string[], indents: [] as number[] }
    return flattenListTree(el.listItems)
  }, [el.listItems])
  const handleItemChange = (index: number, value: string) => {
    const texts = [...flatItems.texts]
    texts[index] = value
    patch({ listItems: buildListTree(texts, flatItems.indents) })
  }
  const handleAddItem = () => {
    const texts = [...flatItems.texts, '']
    const indents = [...flatItems.indents, 0]
    patch({ listItems: buildListTree(texts, indents) })
  }
  const handleRemoveItem = (index: number) => {
    const texts = flatItems.texts.filter((_, i) => i !== index)
    const indents = flatItems.indents.filter((_, i) => i !== index)
    patch({ listItems: buildListTree(texts, indents) })
  }
  const handleMoveItem = (from: number, to: number) => {
    if (to < 0 || to >= flatItems.texts.length) return
    const texts = [...flatItems.texts]
    const indents = [...flatItems.indents]
    const [movedText] = texts.splice(from, 1)
    const [movedIndent] = indents.splice(from, 1)
    texts.splice(to, 0, movedText)
    indents.splice(to, 0, movedIndent)
    patch({ listItems: buildListTree(texts, indents) })
  }

  const LIST_STYLE_OPTIONS: { value: ListStyle; label: string }[] = [
    { value: 'disc', label: 'Bullet (\u2022)' },
    { value: 'circle', label: 'Circle (\u25CB)' },
    { value: 'square', label: 'Square (\u25A0)' },
    { value: 'dash', label: 'Dash (\u2013)' },
    { value: 'number', label: 'Numbered (1. 2. 3.)' },
    { value: 'alpha', label: 'Alpha (a. b. c.)' },
    { value: 'roman', label: 'Roman (i. ii. iii.)' },
    { value: 'none', label: 'None' },
  ]

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-600">
      <FieldSelect
        label="List style"
        id={`ag-list-style-${el.id}`}
        value={el.listStyle ?? 'disc'}
        onChange={(e) => patch({ listStyle: e.target.value as ListStyle })}
        options={LIST_STYLE_OPTIONS}
      />
      <div className="grid grid-cols-3 gap-2">
        <FieldInput
          label="Spacing (pt)"
          id={`ag-list-spacing-${el.id}`}
          type="number"
          min={0}
          step={1}
          value={el.listItemSpacing ?? 4}
          onChange={(e) => patch({ listItemSpacing: Math.max(0, Number(e.target.value) || 0) })}
        />
        <FieldInput
          label="Indent (pt)"
          id={`ag-list-indent-${el.id}`}
          type="number"
          min={0}
          step={1}
          value={el.listIndent ?? 16}
          onChange={(e) => patch({ listIndent: Math.max(0, Number(e.target.value) || 0) })}
        />
        {['number', 'alpha', 'roman'].includes(el.listStyle ?? 'disc') && (
          <FieldInput
            label="Start #"
            id={`ag-list-start-${el.id}`}
            type="number"
            min={1}
            step={1}
            value={el.listStartNumber ?? 1}
            onChange={(e) => patch({ listStartNumber: Math.max(1, Number(e.target.value) || 1) })}
          />
        )}
      </div>
      <FieldCheckbox
        label="Loop (bind to data array)"
        id={`ag-list-loop-${el.id}`}
        checked={loopEnabled}
        onChange={(e) => handleLoopToggle(e.target.checked)}
      />
      {loopEnabled && (
        <>
          <FieldInput
            label="Data key"
            id={`ag-list-datakey-${el.id}`}
            mono
            value={localKey}
            onChange={(e) => handleKeyInput(e.target.value)}
            onBlur={handleKeyBlur}
            placeholder="list_data"
          />
          <FieldCheckbox
            label="Global variable"
            id={`ag-list-global-${el.id}`}
            checked={isGlobal}
            onChange={(e) => handleGlobalToggle(e.target.checked)}
          />
          <FieldInput
            label="Item template"
            id={`ag-list-template-${el.id}`}
            value={el.content ?? '{{.}}'}
            onChange={(e) => patch({ content: e.target.value })}
            placeholder="{{name}} — ${{price}}"
          />
          <FieldInput
            label="Children key"
            id={`ag-list-childrenkey-${el.id}`}
            mono
            value={el.listChildrenKey ?? 'children'}
            onChange={(e) => patch({ listChildrenKey: e.target.value.trim() || undefined })}
            placeholder="children"
          />
          <p className="text-[8px] leading-snug text-zinc-500 lg:text-[10px] dark:text-zinc-400">
            Use <code className="rounded bg-zinc-100 px-0.5 font-mono text-[8px] lg:text-[9px] dark:bg-zinc-700">{'{{.}}'}</code>{' '}
            for string arrays, or <code className="rounded bg-zinc-100 px-0.5 font-mono text-[8px] lg:text-[9px] dark:bg-zinc-700">{'{{key}}'}</code>{' '}
            for object arrays. Nested objects with a{' '}
            <code className="rounded bg-zinc-100 px-0.5 font-mono text-[8px] lg:text-[9px] dark:bg-zinc-700">children</code>{' '}
            array become indented sub-items.
          </p>
        </>
      )}
      {!loopEnabled && (
        <div className="flex flex-col gap-1.5">
          <span className={LABEL_CLASS}>Items</span>
          {flatItems.texts.map((item, i) => (
            <div key={i} className="flex items-center gap-1" style={{ paddingLeft: (flatItems.indents[i] ?? 0) * 12 }}>
              <input
                className="flex-1 rounded border border-zinc-300 px-1.5 py-1 text-[11px] dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                value={item}
                onChange={(e) => handleItemChange(i, e.target.value)}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                placeholder={`Item ${i + 1}`}
              />
              <button
                type="button"
                title="Move up"
                disabled={i === 0}
                onClick={() => handleMoveItem(i, i - 1)}
                className="px-0.5 text-[10px] text-zinc-500 hover:text-zinc-800 disabled:opacity-30 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                &#9650;
              </button>
              <button
                type="button"
                title="Move down"
                disabled={i === flatItems.texts.length - 1}
                onClick={() => handleMoveItem(i, i + 1)}
                className="px-0.5 text-[10px] text-zinc-500 hover:text-zinc-800 disabled:opacity-30 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                &#9660;
              </button>
              <button
                type="button"
                title="Remove item"
                onClick={() => handleRemoveItem(i)}
                className="px-0.5 text-[10px] text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
              >
                &#10005;
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={handleAddItem}
            className="self-start text-[10px] font-medium text-violet-600 hover:underline dark:text-violet-400"
          >
            + Add item
          </button>
        </div>
      )}
    </div>
  )
}

function BehaviourBody() {
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const pages = useEditorStore((s) => s.pages)
  const bandEditorMode = useEditorStore((s) => s.bandCanvasEditElementId != null)
  const bandNestedEditorMounted = useEditorStore((s) => s.bandNestedEditorMounted)
  const bandCanvasEditElementId = useEditorStore((s) => s.bandCanvasEditElementId)
  const activePageElements = useEditorStore(selectActivePageElements)
  const bandScopeElements = useMemo(
    () => documentBandElementsFromFirstPage(pages),
    [pages]
  )
  const openBandContainer = useMemo(() => {
    if (!bandNestedEditorMounted || !bandCanvasEditElementId) return undefined
    return findElementByIdInDocument(pages, bandCanvasEditElementId)
  }, [bandNestedEditorMounted, bandCanvasEditElementId, pages])
  const elements =
    bandNestedEditorMounted && openBandContainer?.bandElements?.length
      ? openBandContainer.bandElements
      : bandEditorMode
        ? bandScopeElements
        : activePageElements
  const variableValues = useEditorStore((s) => s.variableValues)
  const updateElement = useEditorStore((s) => s.updateElement)
  const tableSelection = useEditorStore((s) => s.tableSelection)
  const setEditorSidebarTab = useEditorStore((s) => s.setEditorSidebarTab)
  const ungroupSelection = useEditorStore((s) => s.ungroupSelection)
  const { variableMentionItems, variableKeyOptions, resolveVariableChipDetail, resolveVariableSurfaceLabel } =
    useVariableMentionLists()

  if (selectedIds.length > 1) {
    return (
      <MultiSelectionPanel
        count={selectedIds.length}
        selectedIds={selectedIds}
        elements={elements}
        hideDocumentPage={bandEditorMode}
        bandEditorMode={bandEditorMode}
      />
    )
  }

  const selectedId = primarySelectedId({ selectedIds })
  const el = selectedId ? findElementByIdInDocumentDeep(pages, selectedId) : undefined

  if (!el) {
    return (
      <div className="flex flex-col gap-3 p-3">
        {!bandEditorMode ? <DocumentPageSection /> : null}
        <div className="text-xs text-zinc-500 lg:text-sm dark:text-zinc-400">
          Select an element to edit grouping, lock, table data, and other behaviour.
        </div>
      </div>
    )
  }

  const patch = (p: Partial<LayoutElement>) => updateElement(el.id, p)

  const patchColumnKey = (colIndex: number, key: string) => {
    const cols = [...(el.columns ?? [])]
    if (!cols[colIndex]) return
    cols[colIndex] = { ...cols[colIndex], key: normalizeVariableIdentifier(key) }
    patch({ columns: cols })
  }

  const patchColumnHeader = (colIndex: number, header: string) => {
    const cols = [...(el.columns ?? [])]
    if (!cols[colIndex]) return
    cols[colIndex] = { ...cols[colIndex], header }
    patch({ columns: cols })
  }

  const addTableColumn = () => {
    const prev = el.columns ?? []
    const cols = [...prev]
    const n = cols.length + 1
    cols.push({ header: `Column ${n}`, key: `col_${n}` })
    const weights = [...normalizeColumnWidths(prev.length, el.columnWidths)]
    weights.push(1)
    patch({ columns: cols, columnWidths: weights })
  }

  const removeTableColumn = (colIndex: number) => {
    const prev = el.columns ?? []
    const nextCols = prev.filter((_, i) => i !== colIndex)
    const cols = nextCols.length ? nextCols : [{ header: 'Item', key: 'name' }]
    const w = normalizeColumnWidths(prev.length, el.columnWidths)
    w.splice(colIndex, 1)
    const columnWidths =
      cols.length === w.length && w.length > 0
        ? w
        : normalizeColumnWidths(cols.length, undefined)
    patch({ columns: cols, columnWidths })
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {!bandEditorMode ? <DocumentPageSection /> : null}
      <h2 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 lg:text-xs">Behaviour</h2>

      <FieldCheckbox
        label="Locked (cannot move, resize, or edit on canvas)"
        id={`ag-beh-locked-${el.id}`}
        checked={!!el.locked}
        onChange={(e) => patch({ locked: e.target.checked })}
      />

      {el.groupId && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/90 p-3 dark:border-zinc-600 dark:bg-zinc-800/50">
          <p className="text-[10px] font-medium text-zinc-700 lg:text-xs dark:text-zinc-200">Grouped</p>
          <p className="mt-1 text-[9px] leading-snug text-zinc-600 lg:text-[11px] dark:text-zinc-400">
            This element shares a group with others on the page. Dragging any member moves the whole
            group. Ungroup to edit and move items independently again.
          </p>
          <ActionButton className="mt-2" onClick={() => ungroupSelection()}>
            Ungroup all in this group
          </ActionButton>
        </div>
      )}

      {el.type === 'RING' && (
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-600">
          <p className="mb-2 text-[10px] font-medium text-zinc-700 lg:text-xs dark:text-zinc-200">Ring</p>
          <label className={LABEL_CLASS}>
            <span className="font-medium text-zinc-600 dark:text-zinc-400">
              Inner size (vs outer): {(el.ringInnerRatio ?? 0.55).toFixed(2)}
            </span>
            <input
              id={`ag-beh-ring-inner-${el.id}`}
              name={`ag-beh-ring-inner-${el.id}`}
              type="range"
              min={0.05}
              max={0.95}
              step={0.01}
              value={el.ringInnerRatio ?? 0.55}
              onChange={(e) => patch({ ringInnerRatio: Number(e.target.value) })}
            />
            <span className="text-[8px] text-zinc-500 lg:text-[10px] dark:text-zinc-400">
              Fill and stroke apply to the band between the inner and outer ellipse.
            </span>
          </label>
        </div>
      )}

      {el.type === 'TABLE' && (
        <TableDataSection el={el} patch={patch} />
      )}

      {el.type === 'LIST' && (
        <ListDataSection el={el} patch={patch} />
      )}

      <ElementBehaviourEditor el={el} onPatch={patch} variableKeyOptions={variableKeyOptions} />
    </div>
  )
}

function PropertiesBody() {
  const selectedIds = useEditorStore((s) => s.selectedIds)
  const pages = useEditorStore((s) => s.pages)
  const bandEditorMode = useEditorStore((s) => s.bandCanvasEditElementId != null)
  const bandNestedEditorMounted = useEditorStore((s) => s.bandNestedEditorMounted)
  const updateElement = useEditorStore((s) => s.updateElement)
  const removeElement = useEditorStore((s) => s.removeElement)
  const setEditorSidebarTab = useEditorStore((s) => s.setEditorSidebarTab)

  if (selectedIds.length > 1) {
    return (
      <div className="flex flex-col gap-3 p-3">
        {!bandEditorMode ? <DocumentPageSection /> : null}
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/90 p-3 dark:border-zinc-600 dark:bg-zinc-800/50">
          <p className="text-[10px] font-semibold text-zinc-700 lg:text-xs dark:text-zinc-200">
            {selectedIds.length} elements selected
          </p>
          <p className="mt-1 text-[9px] leading-snug text-zinc-600 lg:text-[11px] dark:text-zinc-400">
            Layout fields apply to one element at a time. Use the{' '}
            <span className="font-medium text-zinc-800 dark:text-zinc-100">Behaviour</span> tab to group,
            ungroup, or delete the selection.
          </p>
          <ActionButton variant="highlight" className="mt-2" onClick={() => setEditorSidebarTab('behaviour')}>
            Open Behaviour tab
          </ActionButton>
        </div>
      </div>
    )
  }

  const selectedId = primarySelectedId({ selectedIds })
  const el = selectedId ? findElementByIdInDocumentDeep(pages, selectedId) : undefined

  if (!el) {
    return (
      <div className="flex flex-col gap-3 p-3">
        {!bandEditorMode ? <DocumentPageSection /> : null}
        <div className="text-xs text-zinc-500 lg:text-sm dark:text-zinc-400">
          {bandNestedEditorMounted
            ? 'Select an element on the band canvas or in the Layers list to edit its layout and typography. Use the Variables tab for preview values.'
            : 'Select an element to edit layout. Use the Variables tab for preview values.'}
        </div>
      </div>
    )
  }

  const patch = (p: Partial<LayoutElement>) => updateElement(el.id, p)
  const showLayoutDelete =
    !bandEditorMode || (el.type !== 'HEADER' && el.type !== 'FOOTER')

  return (
    <div className="flex flex-col gap-3 p-3">
      {!bandEditorMode ? <DocumentPageSection /> : null}
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 lg:text-xs">Layout</h2>
        {showLayoutDelete ? (
          <button
            type="button"
            className="text-[10px] text-red-600 hover:underline lg:text-xs"
            onClick={() => removeElement(el.id)}
          >
            Delete
          </button>
        ) : null}
      </div>
      <p className="text-[10px] text-zinc-600 lg:text-xs dark:text-zinc-400">Type: {el.type}</p>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <FieldInput
          label="X"
          id={`ag-layout-x-${el.id}`}
          type="number"
          value={coerceLayoutScalar(el.x, 0)}
          onChange={(e) => patch({ x: Number(e.target.value) || 0 })}
        />
        <FieldInput
          label="Y"
          id={`ag-layout-y-${el.id}`}
          type="number"
          value={coerceLayoutScalar(el.y, 0)}
          onChange={(e) => patch({ y: Number(e.target.value) || 0 })}
        />
        {el.type !== 'MERGED_SHAPE' ? (
          <>
            <FieldInput
              label="Width"
              id={`ag-layout-w-${el.id}`}
              type="number"
              value={coerceLayoutScalar(el.width, 20)}
              onChange={(e) => patch({ width: Number(e.target.value) || 20 })}
            />
            <FieldInput
              label="Height"
              id={`ag-layout-h-${el.id}`}
              type="number"
              value={coerceLayoutScalar(el.height, 16)}
              onChange={(e) => patch({ height: Number(e.target.value) || 16 })}
            />
          </>
        ) : (
          <p className="col-span-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
            Merged shape size is fixed from the union. Move the element to reposition; use stroke and fill below.
          </p>
        )}
      </div>

      {(isRichTextElement(el) || el.type === 'LIST') && (
        <div className="border-t border-zinc-200 pt-3 dark:border-zinc-600">
          <StyleFields style={el.style} onChange={(s) => patch({ style: s })} />
        </div>
      )}

      {el.type === 'IMAGE' && (
        <>
          <FieldInput
            label="Image URL"
            id={`ag-image-src-${el.id}`}
            type="url"
            value={el.src ?? ''}
            onChange={(e) => patch({ src: e.target.value })}
          />
          <BoxAppearanceFields style={el.style} onChange={(s) => patch({ style: s })} />
          <BorderStyleFields
            style={el.style}
            onChange={(s) => patch({ style: s })}
            showBorderWidth
            showBorderRadius
            showLineStyle
          />
        </>
      )}

      {el.type === 'LINE' && (
        <>
          <FieldInput
            label="Stroke width"
            id={`ag-line-stroke-${el.id}`}
            type="number"
            step={0.5}
            value={el.strokeWidth ?? 1}
            onChange={(e) => patch({ strokeWidth: Number(e.target.value) || 1 })}
          />
          <StrokeColorField style={el.style} onChange={(s) => patch({ style: s })} />
          <BorderStyleFields
            style={el.style}
            onChange={(s) => patch({ style: s })}
            showLineStyle
          />
        </>
      )}

      {el.type === 'BOX' && (
        <>
          <BoxAppearanceFields style={el.style} onChange={(s) => patch({ style: s })} />
          <BorderStyleFields
            style={el.style}
            onChange={(s) => patch({ style: s })}
            showBorderWidth
            showBorderRadius
            showLineStyle
          />
        </>
      )}

      {(el.type === 'ELLIPSE' ||
        el.type === 'TRIANGLE' ||
        el.type === 'ARROW' ||
        el.type === 'DIAMOND' ||
        el.type === 'STAR' ||
        el.type === 'RING') && (
        <>
          <FieldInput
            label="Stroke width"
            id={`ag-shape-stroke-${el.id}`}
            type="number"
            step={0.5}
            value={el.strokeWidth ?? 2}
            onChange={(e) => patch({ strokeWidth: Number(e.target.value) || 1 })}
          />
          <BoxAppearanceFields style={el.style} onChange={(s) => patch({ style: s })} />
          <BorderStyleFields
            style={el.style}
            onChange={(s) => patch({ style: s })}
            showLineStyle
          />
        </>
      )}

      {el.type === 'MERGED_SHAPE' && (
        <>
          <FieldInput
            label="Stroke width"
            id={`ag-merged-stroke-${el.id}`}
            type="number"
            step={0.5}
            value={el.strokeWidth ?? 2}
            onChange={(e) => patch({ strokeWidth: Number(e.target.value) || 1 })}
          />
          <BoxAppearanceFields style={el.style} onChange={(s) => patch({ style: s })} />
          <BorderStyleFields
            style={el.style}
            onChange={(s) => patch({ style: s })}
            showLineStyle
          />
        </>
      )}

      {el.type === 'TABLE' && (
        <div className="flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-600">
          <TableTextColorField style={el.style} onChange={(s) => patch({ style: s })} />
          <div className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-white/80 p-2 dark:border-zinc-600 dark:bg-zinc-900/50">
            <p className="text-[9px] font-medium text-zinc-700 lg:text-[11px] dark:text-zinc-200">Table chrome (canvas)</p>
            <label className="flex cursor-pointer items-center gap-2 text-[10px] text-zinc-700 lg:text-xs dark:text-zinc-200">
              <input
                type="checkbox"
                className="rounded border-zinc-400 text-violet-600 focus:ring-violet-500 dark:border-zinc-500"
                checked={el.tableShowColumnLetters === true}
                onChange={(e) =>
                  patch({ tableShowColumnLetters: e.target.checked ? true : undefined })
                }
              />
              <span>Always show column letters (A, B, …)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[10px] text-zinc-700 lg:text-xs dark:text-zinc-200">
              <input
                type="checkbox"
                className="rounded border-zinc-400 text-violet-600 focus:ring-violet-500 dark:border-zinc-500"
                checked={el.tableShowRowNumbers === true}
                onChange={(e) =>
                  patch({ tableShowRowNumbers: e.target.checked ? true : undefined })
                }
              />
              <span>Always show row numbers (1, 2, …)</span>
            </label>
            <p className="text-[8px] leading-snug text-zinc-500 lg:text-[10px] dark:text-zinc-400">
              By default letters and row labels are hidden; they appear while the pointer is over the table
              (cells, the band above columns, or the strip left of rows). Check the boxes to keep them always
              visible. Chrome sits outside the cell grid, so it does not change cell size. PDF layout is
              unchanged.
            </p>
          </div>
          <p className="text-[8px] leading-snug text-zinc-500 lg:text-[10px] dark:text-zinc-400">
            Data source, column keys, and grouping are in the{' '}
            <button
              type="button"
              className="font-medium text-violet-600 underline hover:no-underline dark:text-violet-400"
              onClick={() => setEditorSidebarTab('behaviour')}
            >
              Behaviour
            </button>{' '}
            tab.
          </p>
        </div>
      )}

      {/* Visual: opacity, rotation, shadow — applies to all element types */}
      <ElementVisualFields style={el.style} onChange={(s) => patch({ style: s })} />
    </div>
  )
}

export function PropertiesPanel() {
  const tab = useEditorStore((s) => s.editorSidebarTab)
  const setTab = useEditorStore((s) => s.setEditorSidebarTab)
  const viewOnly = useEditorStore((s) => s.viewOnly)

  const activeTab = (id: string) =>
    `flex-1 px-1 py-2 text-[10px] font-medium transition-colors lg:px-3 lg:py-2.5 lg:text-sm ${
      tab === id
        ? 'border-b-2 border-violet-600 text-violet-700 dark:text-violet-300'
        : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
    }`

  const disabledTab =
    'flex-1 px-1 py-2 text-[10px] font-medium text-zinc-300 cursor-not-allowed lg:px-3 lg:py-2.5 lg:text-sm dark:text-zinc-600'

  // In view-only mode, auto-redirect to Comments if current tab is edit-only
  const effectiveTab = viewOnly && (tab === 'properties' || tab === 'behaviour' || tab === 'history')
    ? 'comments'
    : tab

  return (
    <aside className="flex w-80 min-w-0 shrink-0 flex-col border-l border-zinc-200 bg-zinc-50 lg:w-[34rem] dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex shrink-0 border-b border-zinc-200 dark:border-zinc-700">
        {viewOnly ? (
          <button type="button" className={disabledTab} disabled title="Not available in view-only mode">
            Properties
          </button>
        ) : (
          <button type="button" className={activeTab('properties')} onClick={() => setTab('properties')}>
            Properties
          </button>
        )}
        {viewOnly ? (
          <button type="button" className={disabledTab} disabled title="Not available in view-only mode">
            Behaviour
          </button>
        ) : (
          <button type="button" className={activeTab('behaviour')} onClick={() => setTab('behaviour')}>
            Behaviour
          </button>
        )}
        <button type="button" className={activeTab('layers')} onClick={() => setTab('layers')}>
          Layers
        </button>
        <button type="button" className={activeTab('variables')} onClick={() => setTab('variables')}>
          Variables
        </button>
        {viewOnly ? (
          <button type="button" className={disabledTab} disabled title="Not available in view-only mode">
            History
          </button>
        ) : (
          <button type="button" className={activeTab('history')} onClick={() => setTab('history')}>
            History
          </button>
        )}
        <button type="button" className={activeTab('comments')} onClick={() => setTab('comments')}>
          Comments
        </button>
        <button type="button" className={activeTab('activity')} onClick={() => setTab('activity')}>
          Activity
        </button>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-auto">
        {effectiveTab === 'properties' ? (
          <PropertiesBody />
        ) : effectiveTab === 'behaviour' ? (
          <BehaviourBody />
        ) : effectiveTab === 'layers' ? (
          <LayersSection />
        ) : effectiveTab === 'history' ? (
          <HistoryPanel />
        ) : effectiveTab === 'comments' ? (
          <CommentsPanel />
        ) : effectiveTab === 'activity' ? (
          <ActivityTab />
        ) : (
          <VariablesSection />
        )}
      </div>
    </aside>
  )
}
