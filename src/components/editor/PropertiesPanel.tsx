import { useCallback, useMemo } from 'react'
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
import {
  coerceLayoutScalar,
  isRichTextElement,
  normalizeColumnWidths,
  pageDimensionsPt,
} from '../../types/layout'
import { normalizeVariableIdentifier } from '../../lib/variables'
import { VariablesSection } from './VariablesSection'
import { LayersSection } from './LayersSection'
import { RichContentEditor } from './RichContentEditor'
import {
  BoxAppearanceFields,
  RichTextAppearanceFields,
  StrokeColorField,
  TableTextColorField,
} from './elementAppearanceFields'
import { ElementBehaviourEditor } from './ElementBehaviourEditor'

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
      <label className="flex flex-col gap-1 text-[10px] lg:text-xs">
        <span className="font-medium text-zinc-600 dark:text-zinc-400">Font size</span>
        <input
          id="ag-editor-style-font-size"
          name="ag-editor-style-font-size"
          type="number"
          className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs lg:px-2 lg:py-1 lg:text-sm dark:border-zinc-600 dark:bg-zinc-800"
          value={s.fontSize ?? 12}
          onChange={(e) => onChange({ ...s, fontSize: Number(e.target.value) || 12 })}
        />
      </label>
      <label className="flex items-center gap-2 text-[10px] lg:text-xs">
        <input
          id="ag-editor-style-bold"
          name="ag-editor-style-bold"
          type="checkbox"
          checked={!!s.bold}
          onChange={(e) => onChange({ ...s, bold: e.target.checked })}
        />
        Bold
      </label>
      <label className="flex items-center gap-2 text-[10px] lg:text-xs">
        <input
          id="ag-editor-style-italic"
          name="ag-editor-style-italic"
          type="checkbox"
          checked={!!s.italic}
          onChange={(e) => onChange({ ...s, italic: e.target.checked })}
        />
        Italic
      </label>
      <label className="flex flex-col gap-1 text-[10px] lg:text-xs">
        <span className="font-medium text-zinc-600 dark:text-zinc-400">Alignment</span>
        <select
          id="ag-editor-style-align"
          name="ag-editor-style-align"
          className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs lg:px-2 lg:py-1 lg:text-sm dark:border-zinc-600 dark:bg-zinc-800"
          value={s.align ?? 'left'}
          onChange={(e) =>
            onChange({ ...s, align: e.target.value as ElementStyle['align'] })
          }
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </label>
      <RichTextAppearanceFields style={s} onChange={onChange} />
    </div>
  )
}

function DocumentPageSection() {
  const pageSpec = useEditorStore((s) => s.pageSpec)
  const setPageMargins = useEditorStore((s) => s.setPageMargins)
  const { width, height } = pageDimensionsPt(pageSpec)
  const m = pageSpec.margins
  const field = (side: keyof typeof m, label: string) => (
    <label key={side} className="flex flex-col gap-0.5 text-[9px] lg:text-[11px]">
      <span className="font-medium text-zinc-600 dark:text-zinc-400">{label} (pt)</span>
      <input
        id={`ag-doc-margin-${side}`}
        name={`ag-doc-margin-${side}`}
        type="number"
        min={0}
        className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs lg:px-2 lg:py-1 lg:text-sm dark:border-zinc-600 dark:bg-zinc-800"
        value={m[side]}
        onChange={(e) =>
          setPageMargins({
            [side]: Math.max(0, Math.round(Number(e.target.value) || 0)),
          })
        }
      />
    </label>
  )
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 p-2.5 dark:border-zinc-600 dark:bg-zinc-900/40">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 lg:text-xs">Document</p>
      <p className="mb-2 text-[9px] leading-snug text-zinc-600 lg:text-[11px] dark:text-zinc-400">
        {pageSpec.size} · {width}×{height} pt. Adjust margins for the dashed printable area; rulers use
        the same point units as the PDF canvas.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {field('left', 'Left')}
        {field('right', 'Right')}
        {field('top', 'Top')}
        {field('bottom', 'Bottom')}
      </div>
    </div>
  )
}

function MultiSelectionPanel({
  count,
  selectedIds,
  elements,
  hideDocumentPage,
  bandEditorMode,
}: {
  count: number
  selectedIds: string[]
  elements: LayoutElement[]
  hideDocumentPage?: boolean
  bandEditorMode?: boolean
}) {
  const groupSelection = useEditorStore((s) => s.groupSelection)
  const ungroupSelection = useEditorStore((s) => s.ungroupSelection)
  const removeElements = useEditorStore((s) => s.removeElements)
  const idSet = new Set(selectedIds)
  const anyGrouped = elements.some((e) => idSet.has(e.id) && e.groupId)

  return (
    <div className="flex flex-col gap-3 p-3">
      {!hideDocumentPage ? <DocumentPageSection /> : null}
      <div className="rounded-lg border border-violet-200 bg-violet-50/80 p-3 dark:border-violet-800 dark:bg-violet-950/30">
        <h2 className="text-[10px] font-semibold uppercase tracking-wide text-violet-800 lg:text-xs dark:text-violet-200">
          {count} selected
        </h2>
        <p className="mt-1 text-[9px] leading-snug text-zinc-600 lg:text-[11px] dark:text-zinc-400">
          ⌘/Ctrl/Shift+click on the canvas to add or remove items. Drag any selected item to move all
          selected together. Group to keep them moving as one even after you click elsewhere.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={bandEditorMode || count < 2}
            title={
              bandEditorMode
                ? 'Grouping is for the main page canvas, not while editing header/footer here.'
                : undefined
            }
            className="rounded-md border border-violet-300 bg-white px-2.5 py-1.5 text-[9px] font-medium text-violet-900 lg:text-[11px] hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-violet-600 dark:bg-violet-900/40 dark:text-violet-100 dark:hover:bg-violet-900/70"
            onClick={() => groupSelection()}
          >
            Group
          </button>
          <button
            type="button"
            disabled={bandEditorMode || !anyGrouped}
            title={
              bandEditorMode
                ? 'Ungroup from the main page canvas, not while editing header/footer here.'
                : undefined
            }
            className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-[9px] font-medium text-zinc-800 lg:text-[11px] hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
            onClick={() => ungroupSelection()}
          >
            Ungroup
          </button>
          <button
            type="button"
            className="rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-[9px] font-medium text-red-700 lg:text-[11px] hover:bg-red-50 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
            onClick={() => removeElements([...selectedIds])}
          >
            Delete all
          </button>
        </div>
      </div>
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

      <label className="flex items-center gap-2 text-[10px] lg:text-xs">
        <input
          id={`ag-beh-locked-${el.id}`}
          name={`ag-beh-locked-${el.id}`}
          type="checkbox"
          checked={!!el.locked}
          onChange={(e) => patch({ locked: e.target.checked })}
        />
        Locked (cannot move, resize, or edit on canvas)
      </label>

      {el.groupId && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/90 p-3 dark:border-zinc-600 dark:bg-zinc-800/50">
          <p className="text-[10px] font-medium text-zinc-700 lg:text-xs dark:text-zinc-200">Grouped</p>
          <p className="mt-1 text-[9px] leading-snug text-zinc-600 lg:text-[11px] dark:text-zinc-400">
            This element shares a group with others on the page. Dragging any member moves the whole
            group. Ungroup to edit and move items independently again.
          </p>
          <button
            type="button"
            className="mt-2 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-[9px] font-medium text-zinc-800 lg:text-[11px] hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
            onClick={() => ungroupSelection()}
          >
            Ungroup all in this group
          </button>
        </div>
      )}

      {el.type === 'RING' && (
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-600">
          <p className="mb-2 text-[10px] font-medium text-zinc-700 lg:text-xs dark:text-zinc-200">Ring</p>
          <label className="flex flex-col gap-1 text-[10px] lg:text-xs">
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
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-600">
          <p className="text-[10px] font-medium text-zinc-700 lg:text-xs dark:text-zinc-200">Table data</p>
          <p className="text-[9px] leading-snug text-zinc-600 lg:text-[11px] dark:text-zinc-400">
            Rows come from a JSON array in the{' '}
            <button
              type="button"
              className="font-medium text-violet-600 underline hover:no-underline dark:text-violet-400"
              onClick={() => setEditorSidebarTab('variables')}
            >
              Variables
            </button>{' '}
            tab (one object per row; keys should match each column&apos;s field key below).
          </p>
          <label className="flex flex-col gap-1 text-[10px] lg:text-xs">
            <span className="font-medium text-zinc-600 dark:text-zinc-400">Data key</span>
            <input
              id={`ag-beh-table-datakey-${el.id}`}
              name={`ag-beh-table-datakey-${el.id}`}
              type="text"
              className="rounded border border-zinc-300 px-1.5 py-0.5 font-mono text-xs lg:px-2 lg:py-1 lg:text-sm dark:border-zinc-600 dark:bg-zinc-800"
              value={el.dataKey ?? ''}
              onChange={(e) => {
                const raw = e.target.value
                if (raw.trim() === '') {
                  patch({ dataKey: undefined })
                  return
                }
                patch({ dataKey: normalizeVariableIdentifier(raw) })
              }}
              placeholder="items"
            />
          </label>
          <div className="flex flex-col gap-2">
            <p className="text-[9px] font-medium text-zinc-600 lg:text-[11px] dark:text-zinc-400">Columns</p>
            <p className="text-[8px] leading-snug text-zinc-500 lg:text-[10px] dark:text-zinc-400">
              Select a column on the canvas to highlight it here. Header rich text; field key maps to row
              JSON keys.
            </p>
            {(el.columns ?? []).map((col, ci) => (
              <div
                key={ci}
                className={`rounded-md border p-2 ${
                  isColumnHighlighted(tableSelection, el.id, ci)
                    ? 'border-violet-500 bg-violet-50/50 dark:border-violet-400 dark:bg-violet-950/20'
                    : 'border-zinc-200 dark:border-zinc-600'
                }`}
              >
                <p className="mb-1 text-[8px] font-medium uppercase tracking-wide text-zinc-500 lg:text-[10px]">
                  Column {ci + 1}
                </p>
                <RichContentEditor
                  sessionKey={`table-${el.id}-col-${ci}`}
                  variableMentions={variableMentionItems}
                  variableValues={variableValues}
                  variableChipDetailResolver={resolveVariableChipDetail}
                  variableSurfaceLabelResolver={resolveVariableSurfaceLabel}
                  content={col.header}
                  onChange={(serialized) => patchColumnHeader(ci, serialized)}
                />
                <label className="mt-2 flex flex-col gap-1 text-[10px] lg:text-xs">
                  <span className="font-medium text-zinc-600 dark:text-zinc-400">Field key</span>
                  <input
                    id={`ag-beh-table-colkey-${el.id}-${ci}`}
                    name={`ag-beh-table-colkey-${el.id}-${ci}`}
                    type="text"
                    className="rounded border border-zinc-300 px-1.5 py-0.5 font-mono text-xs lg:px-2 lg:py-1 lg:text-sm dark:border-zinc-600 dark:bg-zinc-800"
                    value={col.key}
                    onChange={(e) => patchColumnKey(ci, e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={(el.columns?.length ?? 0) <= 1}
                  className="mt-2 text-[9px] text-red-600 lg:text-[11px] hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400"
                  onClick={() => removeTableColumn(ci)}
                >
                  Remove column
                </button>
              </div>
            ))}
            <button
              type="button"
              className="self-start rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-[9px] font-medium text-zinc-800 lg:text-[11px] hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
              onClick={() => addTableColumn()}
            >
              Add column
            </button>
          </div>
        </div>
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
          <button
            type="button"
            className="mt-2 rounded-md border border-violet-300 bg-white px-2.5 py-1.5 text-[9px] font-medium text-violet-900 lg:text-[11px] hover:bg-violet-50 dark:border-violet-600 dark:bg-violet-900/40 dark:text-violet-100 dark:hover:bg-violet-900/70"
            onClick={() => setEditorSidebarTab('behaviour')}
          >
            Open Behaviour tab
          </button>
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
        <label className="flex min-w-0 flex-col gap-1 text-[10px] lg:text-xs">
          <span className="font-medium text-zinc-600 dark:text-zinc-400">X</span>
          <input
            id={`ag-layout-x-${el.id}`}
            name={`ag-layout-x-${el.id}`}
            type="number"
            className="min-w-0 rounded border border-zinc-300 px-1.5 py-0.5 text-xs lg:px-2 lg:py-1 lg:text-sm dark:border-zinc-600 dark:bg-zinc-800"
            value={coerceLayoutScalar(el.x, 0)}
            onChange={(e) => patch({ x: Number(e.target.value) || 0 })}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[10px] lg:text-xs">
          <span className="font-medium text-zinc-600 dark:text-zinc-400">Y</span>
          <input
            id={`ag-layout-y-${el.id}`}
            name={`ag-layout-y-${el.id}`}
            type="number"
            className="min-w-0 rounded border border-zinc-300 px-1.5 py-0.5 text-xs lg:px-2 lg:py-1 lg:text-sm dark:border-zinc-600 dark:bg-zinc-800"
            value={coerceLayoutScalar(el.y, 0)}
            onChange={(e) => patch({ y: Number(e.target.value) || 0 })}
          />
        </label>
        {el.type !== 'MERGED_SHAPE' ? (
          <>
            <label className="flex min-w-0 flex-col gap-1 text-[10px] lg:text-xs">
              <span className="font-medium text-zinc-600 dark:text-zinc-400">Width</span>
              <input
                id={`ag-layout-w-${el.id}`}
                name={`ag-layout-w-${el.id}`}
                type="number"
                className="min-w-0 rounded border border-zinc-300 px-1.5 py-0.5 text-xs lg:px-2 lg:py-1 lg:text-sm dark:border-zinc-600 dark:bg-zinc-800"
                value={coerceLayoutScalar(el.width, 20)}
                onChange={(e) => patch({ width: Number(e.target.value) || 20 })}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-[10px] lg:text-xs">
              <span className="font-medium text-zinc-600 dark:text-zinc-400">Height</span>
              <input
                id={`ag-layout-h-${el.id}`}
                name={`ag-layout-h-${el.id}`}
                type="number"
                className="min-w-0 rounded border border-zinc-300 px-1.5 py-0.5 text-xs lg:px-2 lg:py-1 lg:text-sm dark:border-zinc-600 dark:bg-zinc-800"
                value={coerceLayoutScalar(el.height, 16)}
                onChange={(e) => patch({ height: Number(e.target.value) || 16 })}
              />
            </label>
          </>
        ) : (
          <p className="col-span-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
            Merged shape size is fixed from the union. Move the element to reposition; use stroke and fill below.
          </p>
        )}
      </div>

      {isRichTextElement(el) && (
        <div className="border-t border-zinc-200 pt-3 dark:border-zinc-600">
          <StyleFields style={el.style} onChange={(s) => patch({ style: s })} />
        </div>
      )}

      {el.type === 'IMAGE' && (
        <>
          <label className="flex flex-col gap-1 text-[10px] lg:text-xs">
            <span className="font-medium text-zinc-600 dark:text-zinc-400">Image URL</span>
            <input
              id={`ag-image-src-${el.id}`}
              name={`ag-image-src-${el.id}`}
              type="url"
              className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs lg:px-2 lg:py-1 lg:text-sm dark:border-zinc-600 dark:bg-zinc-800"
              value={el.src ?? ''}
              onChange={(e) => patch({ src: e.target.value })}
            />
          </label>
          <BoxAppearanceFields style={el.style} onChange={(s) => patch({ style: s })} />
        </>
      )}

      {el.type === 'LINE' && (
        <>
          <label className="flex flex-col gap-1 text-[10px] lg:text-xs">
            <span className="font-medium text-zinc-600 dark:text-zinc-400">Stroke width</span>
            <input
              id={`ag-line-stroke-${el.id}`}
              name={`ag-line-stroke-${el.id}`}
              type="number"
              step={0.5}
              className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs lg:px-2 lg:py-1 lg:text-sm dark:border-zinc-600 dark:bg-zinc-800"
              value={el.strokeWidth ?? 1}
              onChange={(e) => patch({ strokeWidth: Number(e.target.value) || 1 })}
            />
          </label>
          <StrokeColorField style={el.style} onChange={(s) => patch({ style: s })} />
        </>
      )}

      {el.type === 'BOX' && (
        <BoxAppearanceFields style={el.style} onChange={(s) => patch({ style: s })} />
      )}

      {(el.type === 'ELLIPSE' ||
        el.type === 'TRIANGLE' ||
        el.type === 'ARROW' ||
        el.type === 'DIAMOND' ||
        el.type === 'STAR' ||
        el.type === 'RING') && (
        <>
          <label className="flex flex-col gap-1 text-[10px] lg:text-xs">
            <span className="font-medium text-zinc-600 dark:text-zinc-400">Stroke width</span>
            <input
              id={`ag-shape-stroke-${el.id}`}
              name={`ag-shape-stroke-${el.id}`}
              type="number"
              step={0.5}
              className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs lg:px-2 lg:py-1 lg:text-sm dark:border-zinc-600 dark:bg-zinc-800"
              value={el.strokeWidth ?? 2}
              onChange={(e) => patch({ strokeWidth: Number(e.target.value) || 1 })}
            />
          </label>
          <BoxAppearanceFields style={el.style} onChange={(s) => patch({ style: s })} />
        </>
      )}

      {el.type === 'MERGED_SHAPE' && (
        <>
          <label className="flex flex-col gap-1 text-[10px] lg:text-xs">
            <span className="font-medium text-zinc-600 dark:text-zinc-400">Stroke width</span>
            <input
              id={`ag-merged-stroke-${el.id}`}
              name={`ag-merged-stroke-${el.id}`}
              type="number"
              step={0.5}
              className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs lg:px-2 lg:py-1 lg:text-sm dark:border-zinc-600 dark:bg-zinc-800"
              value={el.strokeWidth ?? 2}
              onChange={(e) => patch({ strokeWidth: Number(e.target.value) || 1 })}
            />
          </label>
          <BoxAppearanceFields style={el.style} onChange={(s) => patch({ style: s })} />
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
    </div>
  )
}

export function PropertiesPanel() {
  const tab = useEditorStore((s) => s.editorSidebarTab)
  const setTab = useEditorStore((s) => s.setEditorSidebarTab)

  return (
    <aside className="flex w-56 min-w-0 shrink-0 flex-col border-l border-zinc-200 bg-zinc-50 lg:w-96 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex shrink-0 border-b border-zinc-200 dark:border-zinc-700">
        <button
          type="button"
          className={`flex-1 px-1 py-2 text-[10px] font-medium transition-colors lg:px-3 lg:py-2.5 lg:text-sm ${
            tab === 'properties'
              ? 'border-b-2 border-violet-600 text-violet-700 dark:text-violet-300'
              : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
          onClick={() => setTab('properties')}
        >
          Properties
        </button>
        <button
          type="button"
          className={`flex-1 px-1 py-2 text-[10px] font-medium transition-colors lg:px-3 lg:py-2.5 lg:text-sm ${
            tab === 'behaviour'
              ? 'border-b-2 border-violet-600 text-violet-700 dark:text-violet-300'
              : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
          onClick={() => setTab('behaviour')}
        >
          Behaviour
        </button>
        <button
          type="button"
          className={`flex-1 px-1 py-2 text-[10px] font-medium transition-colors lg:px-3 lg:py-2.5 lg:text-sm ${
            tab === 'layers'
              ? 'border-b-2 border-violet-600 text-violet-700 dark:text-violet-300'
              : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
          onClick={() => setTab('layers')}
        >
          Layers
        </button>
        <button
          type="button"
          className={`flex-1 px-1 py-2 text-[10px] font-medium transition-colors lg:px-3 lg:py-2.5 lg:text-sm ${
            tab === 'variables'
              ? 'border-b-2 border-violet-600 text-violet-700 dark:text-violet-300'
              : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
          onClick={() => setTab('variables')}
        >
          Variables
        </button>
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-auto">
        {tab === 'properties' ? (
          <PropertiesBody />
        ) : tab === 'behaviour' ? (
          <BehaviourBody />
        ) : tab === 'layers' ? (
          <LayersSection />
        ) : (
          <VariablesSection />
        )}
      </div>
    </aside>
  )
}
