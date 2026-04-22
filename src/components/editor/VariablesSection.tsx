import { useCallback, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import {
  documentBandElementsFromFirstPage,
  findElementByIdInDocument,
} from '../../lib/documentPageMerge'
import {
  isSystemGlobalVariableKey,
  systemGlobalVariableDefinitions,
} from '../../lib/systemTemplateVariables'
import {
  parseTableVariableData,
  detectTableDataFormatFromJson,
} from '../../lib/tableDataFormat'
import { extractVariableKeys, uniqueListDataKeys, uniqueTableDataKeys } from '../../lib/variables'
import type { VariableDefinition } from '../../types/layout'
import { normalizeCatalogVariableKey } from '../../types/layout'
import { pageLocalShadowStorageKey } from '../../lib/layoutBehaviourResolve'
import { selectAllTemplateElements, useEditorStore } from '../../stores/editorStore'
import type { LayoutElement } from '../../types/layout'

function catalogKeySet(globalDefs: VariableDefinition[], localDefs: VariableDefinition[]): Set<string> {
  const s = new Set<string>()
  for (const d of globalDefs) {
    const k = normalizeCatalogVariableKey(d.key)
    if (k) s.add(k)
  }
  for (const d of localDefs) {
    const k = normalizeCatalogVariableKey(d.key)
    if (k) s.add(k)
  }
  return s
}

/** First row in list order wins; merges descriptions; removes other duplicate rows. */
function mergeDuplicateCatalogRowsAtBlur(
  defs: VariableDefinition[],
  blurredRowIndex: number
): { next: VariableDefinition[]; keptIndex: number } | null {
  const nk = normalizeCatalogVariableKey(defs[blurredRowIndex]?.key ?? '')
  if (!nk) return null

  const dupIndices = defs
    .map((d, i) => (normalizeCatalogVariableKey(d.key) === nk ? i : -1))
    .filter((i): i is number => i >= 0)
    .sort((a, b) => a - b)

  if (dupIndices.length < 2) return null

  const keep = dupIndices[0]!
  const remove = new Set(dupIndices.filter((i) => i !== keep))

  const descParts: string[] = []
  const seenDesc = new Set<string>()
  for (const i of dupIndices) {
    const t = defs[i]?.description?.trim()
    if (t && !seenDesc.has(t)) {
      seenDesc.add(t)
      descParts.push(t)
    }
  }
  const mergedDescription = descParts.length > 0 ? descParts.join('\n') : defs[keep]?.description

  const next: VariableDefinition[] = []
  let keptIndex = -1
  for (let i = 0; i < defs.length; i++) {
    if (remove.has(i)) continue
    if (i === keep) {
      keptIndex = next.length
      next.push({
        ...defs[keep],
        key: nk,
        description:
          mergedDescription === '' || mergedDescription === undefined ? undefined : mergedDescription,
      })
    } else {
      next.push(defs[i]!)
    }
  }
  return { next, keptIndex }
}

function duplicateRowCount(defs: VariableDefinition[], rowIndex: number): number {
  const nk = normalizeCatalogVariableKey(defs[rowIndex]?.key ?? '')
  if (!nk) return 0
  return defs.filter((d) => normalizeCatalogVariableKey(d.key) === nk).length
}

// ── Visual tree editor for list JSON data ──

interface TreeNode {
  text: string
  indent: number
  raw: unknown
}

/** Parse a JSON array (possibly tree-structured) into flat nodes for display. */
function flattenJsonToNodes(json: string, childrenKey: string): TreeNode[] {
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    const nodes: TreeNode[] = []
    function walk(arr: unknown[], depth: number) {
      for (const item of arr) {
        if (typeof item === 'string') {
          nodes.push({ text: item, indent: depth, raw: item })
        } else if (item && typeof item === 'object' && !Array.isArray(item)) {
          const obj = item as Record<string, unknown>
          // Display: use 'text' field, or first string field, or JSON summary
          const displayText =
            typeof obj.text === 'string' ? obj.text
            : typeof obj.name === 'string' ? obj.name
            : typeof obj.title === 'string' ? obj.title
            : typeof obj.label === 'string' ? obj.label
            : Object.entries(obj)
                .filter(([k]) => k !== childrenKey)
                .map(([k, v]) => `${k}: ${String(v ?? '')}`)
                .join(', ')
          nodes.push({ text: displayText, indent: depth, raw: item })
          const children = obj[childrenKey]
          if (Array.isArray(children) && children.length > 0) {
            walk(children, depth + 1)
          }
        } else {
          nodes.push({ text: String(item ?? ''), indent: depth, raw: item })
        }
      }
    }
    walk(parsed, 0)
    return nodes
  } catch {
    return []
  }
}

/**
 * Rebuild JSON tree from flat nodes with (possibly changed) indents.
 * Promotes strings to {text: "…"} when nesting requires it.
 */
function rebuildFromNodes(
  nodes: TreeNode[],
  childrenKey: string,
): unknown[] {
  // Detect whether any string will need children
  let needsPromotion = false
  for (let i = 0; i < nodes.length; i++) {
    if (typeof nodes[i].raw === 'string') {
      const nextIndent = i + 1 < nodes.length ? nodes[i + 1].indent : 0
      if (nextIndent > nodes[i].indent) {
        needsPromotion = true
        break
      }
    }
  }

  const root: unknown[] = []
  const stack: [unknown[], number][] = [[root, -1]]

  for (const { raw, indent, text } of nodes) {
    let node: unknown = raw

    // Promote strings to objects when nesting exists
    if (needsPromotion && typeof node === 'string') {
      node = { text: text }
    }

    if (node && typeof node === 'object' && !Array.isArray(node)) {
      node = { ...(node as Record<string, unknown>) }
      delete (node as Record<string, unknown>)[childrenKey]
    }
    while (stack.length > 1 && stack[stack.length - 1][1] >= indent) stack.pop()
    stack[stack.length - 1][0].push(node)
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      const children: unknown[] = [];
      (node as Record<string, unknown>)[childrenKey] = children
      stack.push([children, indent])
    }
  }

  function clean(arr: unknown[]) {
    for (const item of arr) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const obj = item as Record<string, unknown>
        const ch = obj[childrenKey]
        if (Array.isArray(ch) && ch.length === 0) delete obj[childrenKey]
        else if (Array.isArray(ch)) clean(ch)
      }
    }
  }
  clean(root)
  return root
}

function ListTreeEditor({
  value,
  childrenKey,
  onChange,
}: {
  value: string
  childrenKey: string
  onChange: (json: string) => void
}) {
  const [showRaw, setShowRaw] = useState(false)
  const nodes = useMemo(() => flattenJsonToNodes(value, childrenKey), [value, childrenKey])
  const isStringArray = nodes.length > 0 && nodes.every((n) => typeof n.raw === 'string')

  const updateNodeText = useCallback(
    (index: number, text: string) => {
      const updated = nodes.map((n, i) => {
        if (i !== index) return n
        if (typeof n.raw === 'string') return { ...n, text, raw: text }
        if (n.raw && typeof n.raw === 'object') {
          const obj = { ...(n.raw as Record<string, unknown>) }
          // Update the display field
          if ('text' in obj) obj.text = text
          else if ('name' in obj) obj.name = text
          else if ('title' in obj) obj.title = text
          else if ('label' in obj) obj.label = text
          return { ...n, text, raw: obj }
        }
        return { ...n, text, raw: text }
      })
      onChange(JSON.stringify(rebuildFromNodes(updated, childrenKey)))
    },
    [nodes, childrenKey, onChange],
  )

  const updateNodeIndent = useCallback(
    (index: number, delta: number) => {
      const curIndent = nodes[index]?.indent ?? 0
      const newIndent = Math.max(0, Math.min(8, curIndent + delta))
      if (newIndent === curIndent) return
      // Can't indent deeper than prev item + 1
      if (delta > 0 && index > 0) {
        const prevIndent = nodes[index - 1]?.indent ?? 0
        if (newIndent > prevIndent + 1) return
      }
      const updated = nodes.map((n, i) =>
        i === index ? { ...n, indent: newIndent } : n,
      )
      onChange(JSON.stringify(rebuildFromNodes(updated, childrenKey)))
    },
    [nodes, childrenKey, onChange],
  )

  const addNode = useCallback(() => {
    const newRaw = isStringArray ? '' : { text: '' }
    const newNode: TreeNode = { text: '', indent: 0, raw: newRaw }
    const updated = [...nodes, newNode]
    onChange(JSON.stringify(rebuildFromNodes(updated, childrenKey)))
  }, [nodes, isStringArray, childrenKey, onChange])

  const removeNode = useCallback(
    (index: number) => {
      const updated = nodes.filter((_, i) => i !== index)
      onChange(JSON.stringify(rebuildFromNodes(updated, childrenKey)))
    },
    [nodes, childrenKey, onChange],
  )

  if (nodes.length === 0 && !value.trim()) {
    return (
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => onChange('[""]')}
          className="text-[10px] font-medium text-violet-600 hover:underline dark:text-violet-400"
        >
          + Add first item
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {/* Visual tree */}
      <div className="max-h-[260px] space-y-0.5 overflow-y-auto rounded border border-zinc-200 bg-white p-1.5 dark:border-zinc-700 dark:bg-zinc-900">
        {nodes.map((node, i) => {
          const isObj = node.raw != null && typeof node.raw === 'object'
          return (
            <div
              key={i}
              className="group flex items-center gap-0.5"
              style={{ paddingLeft: node.indent * 14 }}
            >
              {/* Indent/outdent buttons */}
              <button
                type="button"
                title="Outdent"
                onClick={() => updateNodeIndent(i, -1)}
                disabled={node.indent === 0}
                className="h-4 w-3 shrink-0 text-[8px] text-zinc-400 hover:text-zinc-700 disabled:invisible dark:text-zinc-500 dark:hover:text-zinc-300"
              >
                &#x25C0;
              </button>
              <button
                type="button"
                title="Indent"
                onClick={() => updateNodeIndent(i, 1)}
                className="h-4 w-3 shrink-0 text-[8px] text-zinc-400 hover:text-zinc-700 disabled:invisible dark:text-zinc-500 dark:hover:text-zinc-300"
              >
                &#x25B6;
              </button>
              {/* Tree connector */}
              <span className="shrink-0 text-[10px] text-zinc-400 dark:text-zinc-500">
                {node.indent > 0 ? '└' : '●'}
              </span>
              {/* Text input */}
              <input
                className={`min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-[10px] leading-tight focus:border-violet-300 focus:bg-violet-50/50 dark:focus:border-violet-700 dark:focus:bg-violet-950/30 ${
                  isObj && !('text' in (node.raw as Record<string, unknown>)) && !('name' in (node.raw as Record<string, unknown>)) && !('title' in (node.raw as Record<string, unknown>)) && !('label' in (node.raw as Record<string, unknown>))
                    ? 'text-zinc-400 italic dark:text-zinc-500'
                    : 'text-zinc-900 dark:text-zinc-100'
                }`}
                value={node.text}
                onChange={(e) => updateNodeText(i, e.target.value)}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                placeholder={`Item ${i + 1}`}
              />
              {/* Object badge */}
              {isObj && (
                <span className="shrink-0 rounded bg-amber-100 px-1 py-px text-[8px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  obj
                </span>
              )}
              {/* Remove button */}
              <button
                type="button"
                title="Remove"
                onClick={() => removeNode(i)}
                className="shrink-0 px-0.5 text-[10px] text-red-400 opacity-0 hover:text-red-600 group-hover:opacity-100 dark:text-red-500 dark:hover:text-red-400"
              >
                &#10005;
              </button>
            </div>
          )
        })}
      </div>

      {/* Actions row */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={addNode}
          className="text-[10px] font-medium text-violet-600 hover:underline dark:text-violet-400"
        >
          + Add item
        </button>
        <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-semibold text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">
          {nodes.length} item{nodes.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Collapsible raw JSON */}
      <details open={showRaw} onToggle={(e) => setShowRaw((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-[9px] text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300">
          Raw JSON
        </summary>
        <textarea
          className="mt-1 min-h-[48px] w-full resize-y rounded border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[9px] leading-snug text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder='["First item", "Second item"]'
        />
      </details>
    </div>
  )
}

export function VariablesSection() {
  const [mergeFlash, setMergeFlash] = useState<{ scope: 'global' | 'local'; index: number } | null>(null)
  /** Tracks the key value when a field-key input receives focus, so blur can detect renames. */
  const focusedKeyRef = useRef('')
  /** Local editing state for the key input — store is only committed on blur. */
  const [editingKeyField, setEditingKeyField] = useState<{
    scope: 'global' | 'local'
    index: number
    value: string
  } | null>(null)

  const elements = useEditorStore(useShallow(selectAllTemplateElements))
  const pages = useEditorStore((s) => s.pages)
  const bandEditorMode = useEditorStore((s) => s.bandCanvasEditElementId != null)
  const bandNestedEditorMounted = useEditorStore((s) => s.bandNestedEditorMounted)
  const bandCanvasEditElementId = useEditorStore((s) => s.bandCanvasEditElementId)
  const bandElements = useMemo(() => documentBandElementsFromFirstPage(pages), [pages])
  const openBandContainer = useMemo(() => {
    if (!bandNestedEditorMounted || !bandCanvasEditElementId) return undefined
    return findElementByIdInDocument(pages, bandCanvasEditElementId)
  }, [bandNestedEditorMounted, bandCanvasEditElementId, pages])
  const elementsForVarKeys =
    bandNestedEditorMounted && openBandContainer?.bandElements?.length
      ? openBandContainer.bandElements
      : bandEditorMode
        ? bandElements
        : elements
  const activePageIndex = useEditorStore((s) => s.activePageIndex)
  const globalVariableDefinitions = useEditorStore((s) => s.globalVariableDefinitions)
  const setGlobalVariableDefinitions = useEditorStore((s) => s.setGlobalVariableDefinitions)
  const setPageLocalVariableDefinitions = useEditorStore((s) => s.setPageLocalVariableDefinitions)
  const variableValues = useEditorStore((s) => s.variableValues)
  const setVariableValue = useEditorStore((s) => s.setVariableValue)
  const updateElement = useEditorStore((s) => s.updateElement)
  const removeElements = useEditorStore((s) => s.removeElements)

  const activePage = pages[activePageIndex]
  const localDefs = activePage?.localVariables ?? []

  const tableKeys = useMemo(() => new Set(uniqueTableDataKeys(elementsForVarKeys)), [elementsForVarKeys])
  const listKeys = useMemo(() => new Set(uniqueListDataKeys(elementsForVarKeys)), [elementsForVarKeys])
  /** All data-bound element keys (TABLE + LIST). */
  const dataBoundKeys = useMemo(() => new Set([...tableKeys, ...listKeys]), [tableKeys, listKeys])
  const templateKeys = useMemo(() => extractVariableKeys(elementsForVarKeys), [elementsForVarKeys])

  /** When a data-bound variable key is renamed, update the element's dataKey to match. */
  const syncDataKeyRename = (oldKey: string, newKey: string) => {
    if (!oldKey || !newKey || oldKey === newKey) return
    if (!dataBoundKeys.has(oldKey)) return
    const allEls = pages.flatMap((p) => p.elements)
    for (const el of allEls) {
      if ((el.type === 'TABLE' || el.type === 'LIST') && el.dataKey === oldKey) {
        updateElement(el.id, { dataKey: newKey })
      }
    }
    const oldVal = variableValues[oldKey]
    if (oldVal != null) {
      setVariableValue(newKey, oldVal)
    }
  }

  /** Delete element(s) with the given dataKey. removeElements handles variable cleanup. */
  const deleteElementByDataKey = (key: string) => {
    if (!key) return
    const ids: string[] = []
    for (const page of pages) {
      for (const el of page.elements) {
        if ((el.type === 'TABLE' || el.type === 'LIST') && el.dataKey === key) ids.push(el.id)
        if (el.bandElements?.length) {
          for (const bel of el.bandElements) {
            if ((bel.type === 'TABLE' || bel.type === 'LIST') && bel.dataKey === key) ids.push(bel.id)
          }
        }
      }
    }
    if (ids.length > 0) removeElements(ids)
  }

  const declaredHere = useMemo(() => {
    const s = bandEditorMode
      ? catalogKeySet(globalVariableDefinitions, [])
      : catalogKeySet(globalVariableDefinitions, localDefs)
    for (const d of systemGlobalVariableDefinitions()) {
      const k = normalizeCatalogVariableKey(d.key)
      if (k) s.add(k)
    }
    return s
  }, [globalVariableDefinitions, localDefs, bandEditorMode])

  const otherPageCatalogKeys = useMemo(() => {
    if (bandEditorMode) return [] as string[]
    const s = new Set<string>()
    pages.forEach((p, idx) => {
      if (idx === activePageIndex) return
      for (const d of p.localVariables ?? []) {
        const k = normalizeCatalogVariableKey(d.key)
        if (k) s.add(k)
      }
    })
    return [...s].sort()
  }, [pages, activePageIndex, bandEditorMode])

  const extraKeys = useMemo(() => {
    const out: string[] = []
    const seen = new Set<string>(declaredHere)
    for (const k of [...templateKeys, ...otherPageCatalogKeys]) {
      if (isSystemGlobalVariableKey(k)) continue
      if (seen.has(k)) continue
      seen.add(k)
      out.push(k)
    }
    return out.sort()
  }, [templateKeys, otherPageCatalogKeys, declaredHere])

  const fieldClass =
    'rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100'

  const updateGlobalRow = (index: number, patch: Partial<VariableDefinition>) => {
    const row = globalVariableDefinitions[index]
    if (!row) return
    const merged = { ...row, ...patch }
    setGlobalVariableDefinitions(globalVariableDefinitions.map((d, i) => (i === index ? merged : d)))
  }

  const updateLocalRow = (index: number, patch: Partial<VariableDefinition>) => {
    if (!activePage) return
    const row = localDefs[index]
    if (!row) return
    const merged = { ...row, ...patch }
    setPageLocalVariableDefinitions(
      activePage.id,
      localDefs.map((d, i) => (i === index ? merged : d))
    )
  }

  const flashMerged = (scope: 'global' | 'local', keptIndex: number) => {
    setMergeFlash({ scope, index: keptIndex })
    window.setTimeout(() => setMergeFlash(null), 850)
  }

  const onGlobalKeyBlur = (index: number) => {
    const latestDefs = useEditorStore.getState().globalVariableDefinitions
    const oldKey = normalizeCatalogVariableKey(focusedKeyRef.current)
    const newKey = normalizeCatalogVariableKey(latestDefs[index]?.key ?? '')
    if (oldKey && newKey && oldKey !== newKey) {
      syncDataKeyRename(oldKey, newKey)
    }
    const merged = mergeDuplicateCatalogRowsAtBlur(latestDefs, index)
    if (!merged) return
    setGlobalVariableDefinitions(merged.next)
    flashMerged('global', merged.keptIndex)
  }

  const onLocalKeyBlur = (index: number) => {
    const s = useEditorStore.getState()
    const page = s.pages[s.activePageIndex]
    if (!page) return
    const latestDefs = page.localVariables ?? []
    const oldKey = normalizeCatalogVariableKey(focusedKeyRef.current)
    const newKey = normalizeCatalogVariableKey(latestDefs[index]?.key ?? '')
    if (oldKey && newKey && oldKey !== newKey) {
      syncDataKeyRename(oldKey, newKey)
    }
    const merged = mergeDuplicateCatalogRowsAtBlur(latestDefs, index)
    if (!merged) return
    setPageLocalVariableDefinitions(page.id, merged.next)
    flashMerged('local', merged.keptIndex)
  }

  const renderValueEditor = (
    normKey: string,
    isDataBound: boolean,
    fieldIdBase: string,
    /** The element dataKey used to look up the TABLE element (may differ from normKey for local shadow keys). */
    elementDataKey?: string
  ) => {
    if (!normKey) {
      const pid = `${fieldIdBase}-preview-placeholder`
      return (
        <input
          id={pid}
          name={pid}
          type="text"
          className={fieldClass}
          disabled
          placeholder="Set a field name first"
          value=""
          readOnly
        />
      )
    }
    if (isDataBound && (tableKeys.has(normKey) || tableKeys.has(elementDataKey ?? ''))) {
      const raw = variableValues[normKey] ?? ''
      const parsed = parseTableVariableData(raw)
      const format = detectTableDataFormatFromJson(raw)
      const tid = `${fieldIdBase}-table-json`

      if (parsed) {
        // ── Structured format summary card ──
        const headers = parsed.data[0] ?? []
        const bodyRows = Math.max(0, parsed.data.length - 1)
        const colCount = headers.length

        return (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2.5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
                {colCount} col{colCount !== 1 ? 's' : ''} &times; {bodyRows} row{bodyRows !== 1 ? 's' : ''}
              </span>
            </div>

            {headers.length > 0 && (
              <p className="mt-1.5 text-[11px] leading-snug text-emerald-700 dark:text-emerald-300">
                <span className="font-medium">Headers:</span>{' '}
                <span className="font-mono text-[10px]">{headers.join(', ')}</span>
              </p>
            )}

            <details className="mt-2">
              <summary className="cursor-pointer select-none text-[10px] font-medium text-emerald-700 hover:text-emerald-900 dark:text-emerald-400 dark:hover:text-emerald-200">
                Raw JSON
              </summary>
              <textarea
                id={tid}
                name={tid}
                className="mt-1 min-h-[72px] w-full resize-y rounded border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[10px] leading-snug text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                spellCheck={false}
                value={raw}
                onChange={(e) => setVariableValue(normKey, e.target.value)}
              />
            </details>

            <p className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">
              Edit table data directly on the canvas.
            </p>
          </div>
        )
      }

      if (format === 'legacy' && raw.trim()) {
        // ── Legacy format (array of objects) ──
        let legacyRows = 0
        let legacyCols: string[] = []
        try {
          const arr = JSON.parse(raw) as unknown
          if (Array.isArray(arr)) {
            legacyRows = arr.length
            const first = arr[0]
            if (first && typeof first === 'object' && !Array.isArray(first)) {
              legacyCols = Object.keys(first as Record<string, unknown>)
            }
          }
        } catch {
          /* ignore */
        }

        return (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-2.5 dark:border-amber-900/40 dark:bg-amber-950/20">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                Legacy format
              </span>
              {legacyRows > 0 && (
                <span className="text-[11px] text-amber-700 dark:text-amber-300">
                  {legacyRows} row{legacyRows !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {legacyCols.length > 0 && (
              <p className="mt-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
                <span className="font-medium">Keys:</span>{' '}
                <span className="font-mono text-[10px]">{legacyCols.join(', ')}</span>
              </p>
            )}

            <details className="mt-2">
              <summary className="cursor-pointer select-none text-[10px] font-medium text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200">
                Raw JSON
              </summary>
              <textarea
                id={tid}
                name={tid}
                className="mt-1 min-h-[72px] w-full resize-y rounded border border-zinc-300 bg-white px-2 py-1.5 font-mono text-[10px] leading-snug text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                spellCheck={false}
                value={raw}
                onChange={(e) => setVariableValue(normKey, e.target.value)}
              />
            </details>

            <p className="mt-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
              Array of objects. Keys should match each column&apos;s field key.
            </p>
          </div>
        )
      }

      // ── Empty / unparseable — show basic textarea ──
      return (
        <>
          <textarea
            id={tid}
            name={tid}
            className="min-h-[72px] w-full resize-y rounded border border-zinc-300 px-2 py-1.5 font-mono text-[11px] leading-snug text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
            spellCheck={false}
            value={raw}
            onChange={(e) => setVariableValue(normKey, e.target.value)}
            placeholder='{"data":[["Name","Age"],["Alice","30"]]}'
          />
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
            Structured table JSON. Edit on the canvas for best results.
          </span>
        </>
      )
    }
    if (isDataBound && (listKeys.has(normKey) || listKeys.has(elementDataKey ?? ''))) {
      // ── LIST data key — visual tree editor ──
      const listRaw = variableValues[normKey] ?? ''
      // Find the list element's childrenKey
      const listEl = elementsForVarKeys.find(
        (e: LayoutElement) => e.type === 'LIST' && e.dataKey === normKey,
      )
      const childrenKey = listEl?.listChildrenKey?.trim() || 'children'
      return (
        <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-2.5 dark:border-sky-900/40 dark:bg-sky-950/20">
          <ListTreeEditor
            value={listRaw}
            childrenKey={childrenKey}
            onChange={(json) => setVariableValue(normKey, json)}
          />
          <span className="mt-1.5 block text-[9px] text-zinc-500 dark:text-zinc-400">
            Use ◀ ▶ to indent/outdent. Nested items become children in the JSON tree.
          </span>
        </div>
      )
    }
    const sid = `${fieldIdBase}-scalar`
    return (
      <input
        id={sid}
        name={sid}
        type="text"
        className={fieldClass}
        value={variableValues[normKey] ?? ''}
        onChange={(e) => setVariableValue(normKey, e.target.value)}
        placeholder="Preview value"
      />
    )
  }

  const renderCatalogRows = (
    scope: 'global' | 'local',
    defs: VariableDefinition[],
    onUpdateRow: (i: number, p: Partial<VariableDefinition>) => void,
    onRemoveRow: (i: number) => void,
    onAddRow: () => void,
    onKeyBlur: (i: number) => void
  ) => (
    <>
      <ul className="flex flex-col gap-3">
        {defs.map((d, i) => {
          const nk = normalizeCatalogVariableKey(d.key)
          const isDataBound = dataBoundKeys.has(nk)
          const dupN = duplicateRowCount(defs, i)
          const isDup = dupN > 1
          const isFlash = mergeFlash?.scope === scope && mergeFlash.index === i
          const previewStorageKey =
            scope === 'local' &&
            nk &&
            globalVariableDefinitions.some((d) => normalizeCatalogVariableKey(d.key) === nk)
              ? pageLocalShadowStorageKey(nk)
              : nk

          return (
            <li
              key={`${scope}-${i}`}
              className={[
                'rounded-lg border p-3 transition-[transform,box-shadow,background-color,border-color] duration-500 ease-out',
                isDup
                  ? 'border-red-300 bg-red-50/80 dark:border-red-900/55 dark:bg-red-950/25'
                  : 'border-zinc-200 bg-white/90 dark:border-zinc-600 dark:bg-zinc-900/50',
                isFlash ? 'scale-[1.02] shadow-lg ring-2 ring-teal-400/90 dark:ring-teal-500/80' : '',
              ].join(' ')}
            >
              {isDup ? (
                <p className="mb-2 text-[10px] font-medium leading-snug text-red-800 dark:text-red-200">
                  Same key as another row in this list. Click away from the key field to merge into the
                  first row (descriptions are combined).
                </p>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-zinc-600 dark:text-zinc-400">Field key</span>
                  <input
                    id={`ag-var-${scope}-${i}-key`}
                    name={`ag-var-${scope}-${i}-key`}
                    type="text"
                    className={`${fieldClass} font-mono text-xs`}
                    value={
                      editingKeyField?.scope === scope && editingKeyField.index === i
                        ? editingKeyField.value
                        : d.key
                    }
                    onFocus={() => {
                      focusedKeyRef.current = d.key
                      setEditingKeyField({ scope, index: i, value: d.key })
                    }}
                    onChange={(e) => {
                      setEditingKeyField((prev) =>
                        prev ? { ...prev, value: e.target.value } : null
                      )
                    }}
                    onBlur={() => {
                      const finalVal = editingKeyField?.value ?? d.key
                      const oldKey = normalizeCatalogVariableKey(focusedKeyRef.current)
                      setEditingKeyField(null)
                      // Clearing a table-owned key → delete the table element (+ variable cleanup)
                      if (!finalVal.trim() && oldKey && dataBoundKeys.has(oldKey)) {
                        deleteElementByDataKey(oldKey)
                        return
                      }
                      onUpdateRow(i, { key: finalVal })
                      onKeyBlur(i)
                    }}
                    placeholder="e.g. customer_name"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                  <span className="font-medium text-zinc-600 dark:text-zinc-400">Description (optional)</span>
                  <input
                    id={`ag-var-${scope}-${i}-description`}
                    name={`ag-var-${scope}-${i}-description`}
                    type="text"
                    className={fieldClass}
                    value={d.description ?? ''}
                    onChange={(e) => onUpdateRow(i, { description: e.target.value || undefined })}
                    placeholder="Shown to authors in the catalog only"
                  />
                </label>
              </div>
              <div className="mt-2 flex flex-col gap-1">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {isDataBound && nk ? (tableKeys.has(nk) ? 'Table data' : 'List data') : 'Preview value'}
                </span>
                {scope === 'local' && nk && previewStorageKey !== nk ? (
                  <p className="text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
                    Same name as a global field — this preview is stored as{' '}
                    <code className="rounded bg-zinc-100 px-0.5 font-mono dark:bg-zinc-800">
                      {previewStorageKey}
                    </code>{' '}
                    so template-wide and page values stay separate. Use the matching entry from the{' '}
                    <kbd className="rounded border border-zinc-300 px-0.5 font-mono dark:border-zinc-600">@</kbd>{' '}
                    list when inserting into text.
                  </p>
                ) : null}
                {renderValueEditor(previewStorageKey, isDataBound, `ag-var-${scope}-${i}`, nk)}
              </div>
              {!isDataBound && (
                <button
                  type="button"
                  className="mt-2 text-[11px] text-red-600 hover:underline dark:text-red-400"
                  onClick={() => onRemoveRow(i)}
                >
                  Remove row
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        className="mt-2 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
        onClick={onAddRow}
      >
        Add variable
      </button>
    </>
  )

  return (
    <div className="flex flex-col gap-8 p-3">
      {bandEditorMode ? (
        <p className="text-xs leading-snug text-zinc-500 dark:text-zinc-400">
          While editing <span className="font-medium text-zinc-600 dark:text-zinc-300">header / footer</span>, only{' '}
          <span className="font-medium text-zinc-600 dark:text-zinc-300">global</span> template variables (and
          built-ins) are listed — merge fields in the band use these keys. Single-line previews feed{' '}
          <code className="font-mono text-[10px]">{'{{tokens}}'}</code>; JSON arrays feed table row data.
        </p>
      ) : (
        <p className="text-xs leading-snug text-zinc-500 dark:text-zinc-400">
          <span className="font-medium text-zinc-600 dark:text-zinc-300">Global</span> names are available on
          every page. <span className="font-medium text-zinc-600 dark:text-zinc-300">Local</span> names apply
          to the current page only. Single-line preview values feed text tokens;{' '}
          <span className="font-medium">JSON arrays</span> feed table row data.
        </p>
      )}

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
          Global variables
        </h3>
        <p className="mb-3 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
          Declared for the whole template (saved as <code className="font-mono">globalVariables</code> in
          layout JSON).
        </p>
        <ul className="mb-4 flex flex-col gap-3">
          {systemGlobalVariableDefinitions().map((d) => {
            const nk = normalizeCatalogVariableKey(d.key)
            return (
              <li
                key={`builtin-${nk}`}
                className="rounded-lg border border-zinc-200 bg-zinc-50/90 p-3 dark:border-zinc-600 dark:bg-zinc-800/40"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Built-in (read-only)
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="font-medium text-zinc-600 dark:text-zinc-400">Field key</span>
                    <input
                      type="text"
                      className={`${fieldClass} cursor-not-allowed font-mono text-xs opacity-90`}
                      value={d.key}
                      readOnly
                      disabled
                      title="This variable is provided by the editor and cannot be renamed."
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs sm:col-span-2">
                    <span className="font-medium text-zinc-600 dark:text-zinc-400">Description</span>
                    <input
                      type="text"
                      className={`${fieldClass} cursor-not-allowed opacity-90`}
                      value={d.description ?? ''}
                      readOnly
                      disabled
                    />
                  </label>
                </div>
                <div className="mt-2 flex flex-col gap-1">
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Preview value</span>
                  <input
                    type="text"
                    className={`${fieldClass} cursor-not-allowed font-mono text-xs opacity-90`}
                    value={nk ? variableValues[nk] ?? '' : ''}
                    readOnly
                    disabled
                    title="Computed from the document; not editable."
                  />
                </div>
              </li>
            )
          })}
        </ul>
        {renderCatalogRows(
          'global',
          globalVariableDefinitions,
          updateGlobalRow,
          (i) => setGlobalVariableDefinitions(globalVariableDefinitions.filter((_, j) => j !== i)),
          () => setGlobalVariableDefinitions([...globalVariableDefinitions, { key: '', description: '' }]),
          onGlobalKeyBlur
        )}
      </section>

      {activePage && !bandEditorMode ? (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
            Local variables — {activePage.name}
          </h3>
          <p className="mb-3 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
            Only this page&apos;s behaviour and content should use these keys; they are stored under this
            page in layout JSON.
          </p>
          {renderCatalogRows(
            'local',
            localDefs,
            updateLocalRow,
            (i) =>
              setPageLocalVariableDefinitions(
                activePage.id,
                localDefs.filter((_, j) => j !== i)
              ),
            () =>
              setPageLocalVariableDefinitions(activePage.id, [
                ...localDefs,
                { key: '', description: '' },
              ]),
            onLocalKeyBlur
          )}
        </section>
      ) : null}

      {!bandEditorMode && extraKeys.length > 0 ? (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
            Also used in this template
          </h3>
          <p className="mb-3 text-[10px] text-zinc-500 dark:text-zinc-400">
            Keys referenced in text or tables, or declared on another page, that are not listed in the
            sections above.
          </p>
          <ul className="flex flex-col gap-4">
            {extraKeys.map((k) => {
              const isDataBound = dataBoundKeys.has(k)
              return (
                <li key={k}>
                  <label className="flex flex-col gap-1.5 text-xs">
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      {k}
                    </span>
                    {renderValueEditor(
                      k,
                      isDataBound,
                      `ag-var-extra-${k.replace(/[^a-zA-Z0-9_-]/g, '_')}`
                    )}
                  </label>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {globalVariableDefinitions.length === 0 &&
      (bandEditorMode || localDefs.length === 0) &&
      extraKeys.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {bandEditorMode
            ? 'No custom globals yet. Add names under Global variables above, or insert merge fields in the band text.'
            : 'No variables yet. Add global or local names above, or insert merge fields in text on the canvas.'}
        </p>
      ) : null}
    </div>
  )
}
