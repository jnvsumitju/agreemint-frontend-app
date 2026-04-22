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
import type { ElementStyle, LayoutElement } from '../../types/layout'
import { LABEL_CLASS } from './uiClasses'
import { FieldInput } from './ui/FieldInput'
import { FieldSelect } from './ui/FieldSelect'
import { FieldCheckbox } from './ui/FieldCheckbox'
import { ActionButton } from './ui/ActionButton'
import {
  coerceLayoutScalar,
  isRichTextElement,
} from '../../types/layout'
import { defaultSampleListItemsJson, normalizeVariableIdentifier } from '../../lib/variables'
import type { ListStyle } from '../../types/layout'
import { buildListTree, flattenListTree } from '../../types/layout'
import {
  buildInitialStructuredData,
  serializeTableVariableData,
} from '../../lib/tableDataFormat'
import { tablePreviewBodyRowCount } from '../../lib/tablePreview'
import { VariablesSection } from './VariablesSection'
import { LayersSection } from './LayersSection'
import { HistoryPanel } from './HistoryPanel'
import { CommentsPanel } from './CommentsPanel'
import { ActivityTab } from './ActivityTab'
import { ReviewsPanel } from './ReviewsPanel'
// RichContentEditor import reserved for future use
import {
  BoxAppearanceFields,
  RichTextAppearanceFields,
  StrokeColorField,
  TableTextColorField,
  ElementVisualFields,
  BorderStyleFields,
} from './elementAppearanceFields'
import { allFontFamilies, coerceToSupportedFamily, loadFont } from '../../lib/fontLoader'
import { ElementBehaviourEditor } from './ElementBehaviourEditor'
import { DocumentPageSection } from './DocumentPageSection'
import { MultiSelectionPanel } from './MultiSelectionPanel'
import { TabBar } from './ui/TabBar'
import { Tooltip } from './ui/Tooltip'
import { BindingIndicator, BindingIndicatorSummary } from './BindingIndicator'

/**
 * localStorage keys — the right panel persists its collapsed-to-rail state
 * and its user-chosen px width across sessions. Two different states so
 * the rail click can restore the user's preferred drag-resized width.
 */
const RIGHT_PANEL_COLLAPSED_KEY = 'agreemint-right-panel-collapsed'
const RIGHT_PANEL_WIDTH_KEY = 'agreemint-right-panel-width'

/** Smallest the panel can be dragged to — enough for 8 icon-only tabs and
 *  the collapse button without horizontal scroll. */
const RIGHT_PANEL_MIN_WIDTH_PX = 300
/** Largest it can be dragged to (leaves room for canvas + left palette). */
const RIGHT_PANEL_MAX_WIDTH_PX = 800
/** Below this, the TabBar hides labels and shows icons only. Chosen so
 *  all 8 labelled tabs just fit horizontally at default font size. */
const RIGHT_PANEL_ICON_ONLY_THRESHOLD_PX = 480
/** Sensible starting width — matches the previous `lg:w-[34rem]`. */
const RIGHT_PANEL_DEFAULT_WIDTH_PX = 544

function clampPanelWidth(n: number): number {
  return Math.max(RIGHT_PANEL_MIN_WIDTH_PX, Math.min(RIGHT_PANEL_MAX_WIDTH_PX, n))
}

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
  element,
}: {
  style: ElementStyle | undefined
  onChange: (s: ElementStyle) => void
  element?: LayoutElement
}) {
  const s = style ?? {}
  return (
    <div className="flex flex-col gap-2">
      <FieldSelect
        label="Font family"
        id="ag-editor-style-font-family"
        value={s.fontFamily ?? ''}
        onChange={(e) => {
          const raw = e.target.value
          if (raw) {
            // Under pixel-parity, non-curated families are silently coerced
            // to the default sans so canvas and PDF agree on glyph bytes.
            // Off the flag, coerce is a pass-through.
            const v = coerceToSupportedFamily(raw) ?? raw
            loadFont(v)
            onChange({ ...s, fontFamily: v })
          } else {
            const rest = { ...s }
            delete rest.fontFamily
            onChange(rest)
          }
        }}
        options={(() => {
          const families = allFontFamilies()
          const curr = s.fontFamily
          const isCurrentUnlisted = curr && curr.trim() && !families.includes(curr)
          return [
            { value: '', label: 'Default' },
            // Surface a legacy/non-parity value if the layout stored one —
            // otherwise the picker silently shows no selection while the
            // renderer falls back to Inter. Making it selectable lets the
            // author see + replace it, and the trailing "(renders as Inter)"
            // is the visibility fix for the previously-silent coerce.
            ...(isCurrentUnlisted
              ? [{ value: curr!, label: `${curr} (renders as Inter)` }]
              : []),
            ...families.map((family) => ({ value: family, label: family })),
          ]
        })()}
        labelAdornment={
          element ? <BindingIndicator element={element} target="fontFamily" /> : undefined
        }
      />
      <FieldInput
        label="Font size"
        id="ag-editor-style-font-size"
        type="number"
        value={s.fontSize ?? 12}
        onChange={(e) => {
          const raw = Number(e.target.value)
          // Clamp to a sane range: 6pt floor reads safely even on a print,
          // 400pt ceiling prevents a stray 9999 from blowing up layout
          // measurement. Matches the authoring conventions in most editors.
          const next = Number.isFinite(raw) ? Math.max(6, Math.min(400, Math.round(raw))) : 12
          onChange({ ...s, fontSize: next })
        }}
        labelAdornment={
          element ? <BindingIndicator element={element} target="fontSize" /> : undefined
        }
      />
      <FieldInput
        label="Line height"
        id="ag-editor-style-line-height"
        type="number"
        step={0.1}
        value={s.lineHeight ?? 1.4}
        onChange={(e) => {
          const v = Number(e.target.value)
          // Minimum 1.0 — values below collapse descenders into the next
          // line on both canvas and PDF. Maximum 5.0 keeps the typography
          // from visibly exploding when somebody enters 50 by accident.
          if (Number.isFinite(v) && v >= 1 && v <= 5) onChange({ ...s, lineHeight: Math.round(v * 10) / 10 })
        }}
        labelAdornment={
          element ? <BindingIndicator element={element} target="lineHeight" /> : undefined
        }
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
        labelAdornment={
          element ? <BindingIndicator element={element} target="textAlign" /> : undefined
        }
      />
      <RichTextAppearanceFields style={s} onChange={onChange} element={element} />
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
      patch({ dataKey: undefined })
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
  const updateElement = useEditorStore((s) => s.updateElement)
  const ungroupSelection = useEditorStore((s) => s.ungroupSelection)
  const { variableKeyOptions } =
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

  return (
    <div className="flex flex-col gap-3 p-3">
      {!bandEditorMode ? <DocumentPageSection /> : null}
      <h2 className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 lg:text-xs">Behaviour</h2>

      {/* The Lock toggle used to live here, but it's already exposed per-row
          in the Layers panel — keeping both created two competing controls
          for the same field. Lock is owned by Layers now. */}

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

      {/* Rollup of every active binding on this element. Each chip jumps
          to its rule in the Behaviour tab — lets users spot "why is this
          field frozen / an unexpected color?" at a glance. */}
      <BindingIndicatorSummary element={el} />

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <FieldInput
          label="X"
          id={`ag-layout-x-${el.id}`}
          type="number"
          value={coerceLayoutScalar(el.x, 0)}
          onChange={(e) => patch({ x: Number(e.target.value) || 0 })}
          labelAdornment={<BindingIndicator element={el} target="x" />}
        />
        <FieldInput
          label="Y"
          id={`ag-layout-y-${el.id}`}
          type="number"
          value={coerceLayoutScalar(el.y, 0)}
          onChange={(e) => patch({ y: Number(e.target.value) || 0 })}
          labelAdornment={<BindingIndicator element={el} target="y" />}
        />
        {el.type !== 'MERGED_SHAPE' ? (
          <>
            <FieldInput
              label="Width"
              id={`ag-layout-w-${el.id}`}
              type="number"
              value={coerceLayoutScalar(el.width, 20)}
              onChange={(e) => patch({ width: Number(e.target.value) || 20 })}
              labelAdornment={<BindingIndicator element={el} target="width" />}
            />
            <FieldInput
              label="Height"
              id={`ag-layout-h-${el.id}`}
              type="number"
              value={coerceLayoutScalar(el.height, 16)}
              onChange={(e) => patch({ height: Number(e.target.value) || 16 })}
              labelAdornment={<BindingIndicator element={el} target="height" />}
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
          <StyleFields style={el.style} onChange={(s) => patch({ style: s })} element={el} />
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
            labelAdornment={<BindingIndicator element={el} target="imageSrc" />}
          />
          <BoxAppearanceFields style={el.style} onChange={(s) => patch({ style: s })} element={el} />
          <BorderStyleFields
            style={el.style}
            onChange={(s) => patch({ style: s })}
            showBorderWidth
            showBorderRadius
            showLineStyle
            element={el}
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
            labelAdornment={<BindingIndicator element={el} target="strokeWidth" />}
          />
          <StrokeColorField style={el.style} onChange={(s) => patch({ style: s })} element={el} />
          <BorderStyleFields
            style={el.style}
            onChange={(s) => patch({ style: s })}
            showLineStyle
            element={el}
          />
        </>
      )}

      {el.type === 'BOX' && (
        <>
          <BoxAppearanceFields style={el.style} onChange={(s) => patch({ style: s })} element={el} />
          <BorderStyleFields
            style={el.style}
            onChange={(s) => patch({ style: s })}
            showBorderWidth
            showBorderRadius
            showLineStyle
            element={el}
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
            labelAdornment={<BindingIndicator element={el} target="strokeWidth" />}
          />
          <BoxAppearanceFields style={el.style} onChange={(s) => patch({ style: s })} element={el} />
          <BorderStyleFields
            style={el.style}
            onChange={(s) => patch({ style: s })}
            showLineStyle
            element={el}
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
            labelAdornment={<BindingIndicator element={el} target="strokeWidth" />}
          />
          <BoxAppearanceFields style={el.style} onChange={(s) => patch({ style: s })} element={el} />
          <BorderStyleFields
            style={el.style}
            onChange={(s) => patch({ style: s })}
            showLineStyle
            element={el}
          />
        </>
      )}

      {el.type === 'TABLE' && (
        <div className="flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-600">
          <TableTextColorField style={el.style} onChange={(s) => patch({ style: s })} element={el} />
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
      <ElementVisualFields style={el.style} onChange={(s) => patch({ style: s })} element={el} />
    </div>
  )
}

export function PropertiesPanel() {
  const tab = useEditorStore((s) => s.editorSidebarTab)
  const setTab = useEditorStore((s) => s.setEditorSidebarTab)
  const viewOnly = useEditorStore((s) => s.viewOnly)

  // Persisted collapsed-to-rail state — a hard snap to w-10 with only icons
  // stacked vertically. Separate from the drag width so the rail click can
  // restore the user's preferred wide layout.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(RIGHT_PANEL_COLLAPSED_KEY) === '1'
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(RIGHT_PANEL_COLLAPSED_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  // Persisted drag-resized width in pixels. User can drag the left edge of
  // the panel to narrow or widen; below ICON_ONLY_THRESHOLD the tab bar
  // auto-hides labels and shows icons only.
  const [panelWidthPx, setPanelWidthPx] = useState<number>(() => {
    if (typeof window === 'undefined') return RIGHT_PANEL_DEFAULT_WIDTH_PX
    const raw = window.localStorage.getItem(RIGHT_PANEL_WIDTH_KEY)
    const parsed = raw == null ? NaN : Number(raw)
    return Number.isFinite(parsed) ? clampPanelWidth(parsed) : RIGHT_PANEL_DEFAULT_WIDTH_PX
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(RIGHT_PANEL_WIDTH_KEY, String(panelWidthPx))
  }, [panelWidthPx])

  const iconOnly = panelWidthPx < RIGHT_PANEL_ICON_ONLY_THRESHOLD_PX

  // Drag handle wiring. Handle is on the LEFT edge of the right panel; moving
  // the mouse to the right narrows the panel (new width = initial − delta).
  const dragStartRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const onResizeMove = useCallback((e: PointerEvent) => {
    const start = dragStartRef.current
    if (!start || e.pointerId !== start.pointerId) return
    setPanelWidthPx(clampPanelWidth(start.startWidth - (e.clientX - start.startX)))
  }, [])
  const onResizeEnd = useCallback((e: PointerEvent) => {
    const start = dragStartRef.current
    if (!start || e.pointerId !== start.pointerId) return
    dragStartRef.current = null
    window.removeEventListener('pointermove', onResizeMove)
    window.removeEventListener('pointerup', onResizeEnd)
    window.removeEventListener('pointercancel', onResizeEnd)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }, [onResizeMove])
  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only left-mouse / primary-touch.
    if (e.button !== 0 && e.pointerType === 'mouse') return
    dragStartRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startWidth: panelWidthPx,
    }
    window.addEventListener('pointermove', onResizeMove)
    window.addEventListener('pointerup', onResizeEnd)
    window.addEventListener('pointercancel', onResizeEnd)
    // Block text-selection flicker + make the cursor follow the handle.
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    e.preventDefault()
  }

  // In view-only mode, redirect edit-only tabs to history
  const effectiveTab = viewOnly && (tab === 'properties' || tab === 'behaviour' || tab === 'layers' || tab === 'variables')
    ? 'history'
    : tab

  const sidebarTabs = useMemo(() => {
    const tabs = [
      { key: 'properties', label: 'Props', icon: <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /></svg> },
      { key: 'behaviour', label: 'Rules', icon: <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg> },
      { key: 'layers', label: 'Layers', icon: <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0l4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0l-5.571 3-5.571-3" /></svg> },
      { key: 'variables', label: 'Vars', icon: <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.745 3A23.933 23.933 0 003 12c0 3.183.62 6.22 1.745 9M19.5 3c.967 2.78 1.5 5.817 1.5 9s-.533 6.22-1.5 9M8.25 8.885l1.444-.89a.75.75 0 011.105.402l2.402 7.206a.75.75 0 001.104.401l1.445-.889" /></svg> },
      { key: 'history', label: 'History', icon: <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
      { key: 'comments', label: 'Comments', icon: <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg> },
      { key: 'activity', label: 'Activity', icon: <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" /></svg> },
      { key: 'reviews', label: 'Reviews', icon: <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg> },
    ]
    // In view-only mode: show only History, Comments, Activity, Reviews
    if (viewOnly) {
      return tabs.filter((t) => ['history', 'comments', 'activity', 'reviews'].includes(t.key))
    }
    return tabs
  }, [viewOnly])

  // Collapsed — icon rail only. Clicking any icon sets the tab AND expands.
  if (collapsed) {
    return (
      <aside className="flex w-10 shrink-0 flex-col items-center border-l border-zinc-200 bg-white py-1.5 transition-[width] duration-200 dark:border-zinc-700 dark:bg-zinc-900">
        <Tooltip content="Expand panel" position="left">
          <button
            type="button"
            className="mb-1 flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            onClick={() => setCollapsed(false)}
            aria-label="Expand panel"
          >
            {/* Chevrons pointing left — panel expands back to the left. */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M11 5l-7 7 7 7M19 5l-7 7 7 7" />
            </svg>
          </button>
        </Tooltip>
        <div className="w-full border-t border-zinc-100 dark:border-zinc-800" />
        <div className="mt-1 flex flex-col gap-0.5 px-1">
          {sidebarTabs.map((t) => {
            const isActive = t.key === effectiveTab
            return (
              <Tooltip key={t.key} content={t.label} position="left">
                <button
                  type="button"
                  onClick={() => {
                    setTab(t.key as Parameters<typeof setTab>[0])
                    setCollapsed(false)
                  }}
                  aria-label={t.label}
                  aria-pressed={isActive}
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                    isActive
                      ? 'bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
                      : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'
                  }`}
                >
                  {t.icon}
                </button>
              </Tooltip>
            )
          })}
        </div>
      </aside>
    )
  }

  return (
    <aside
      style={{ width: `${panelWidthPx}px` }}
      className="relative flex min-w-0 shrink-0 flex-col border-l border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
    >
      {/*
        Drag handle on the LEFT edge of the panel. Wider than the visible
        border so it's easy to grab, but transparent so it doesn't add visual
        weight. Hover/active give a subtle violet tint. Pointer events handle
        both mouse + touch; the panel width is clamped so dragging stops at
        the icons-only minimum.
      */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        title="Drag to resize"
        onPointerDown={onResizeStart}
        className="group absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none"
      >
        <div className="mx-auto h-full w-0.5 bg-transparent transition-colors group-hover:bg-violet-400/60 group-active:bg-violet-500" />
      </div>

      {/* Tab bar + collapse toggle on the right end. */}
      <div className="relative flex shrink-0 items-stretch">
        <div className="min-w-0 flex-1">
          <TabBar
            tabs={sidebarTabs}
            activeKey={effectiveTab}
            onChange={(key) => setTab(key as Parameters<typeof setTab>[0])}
            size="sm"
            iconOnly={iconOnly}
          />
        </div>
        <button
          type="button"
          title="Collapse panel — show icons only"
          className="flex shrink-0 items-center border-b border-zinc-100 px-1.5 text-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:hover:text-zinc-200"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse panel"
        >
          {/* Chevrons pointing right — panel collapses off to the right. */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
            <path d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
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
        ) : effectiveTab === 'reviews' ? (
          <ReviewsPanel />
        ) : (
          <VariablesSection />
        )}
      </div>
    </aside>
  )
}
