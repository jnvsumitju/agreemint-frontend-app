import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore } from '../../stores/editorStore'
import type { LayoutElement, ListStyle } from '../../types/layout'
import { buildListTree, flattenListTree } from '../../types/layout'
import { RichTextBlockPreview } from './RichTextBlockPreview'
import { variableMergeFieldSurfaceLabel } from '../../lib/layoutBehaviourResolve'
import { substituteVariables } from '../../lib/variables'
import { gradientToCss, isValidGradient } from '../../lib/gradientUtils'
import { coerceToSupportedFamily } from '../../lib/fontLoader'
import type { CSSProperties } from 'react'

// ── Marker helpers ──

function toAlpha(n: number): string {
  let result = ''
  let num = n
  while (num > 0) {
    num--
    result = String.fromCharCode(97 + (num % 26)) + result
    num = Math.floor(num / 26)
  }
  return result
}

function toRoman(n: number): string {
  if (n <= 0 || n > 3999) return String(n)
  const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1]
  const syms = ['m', 'cm', 'd', 'cd', 'c', 'xc', 'l', 'xl', 'x', 'ix', 'v', 'iv', 'i']
  let result = ''
  let num = n
  for (let i = 0; i < vals.length; i++) {
    while (num >= vals[i]) {
      result += syms[i]
      num -= vals[i]
    }
  }
  return result
}

export function markerForIndex(style: ListStyle, index: number, startNumber: number): string {
  const n = startNumber + index
  switch (style) {
    case 'disc':
      return '\u2022'
    case 'circle':
      return '\u25CB'
    case 'square':
      return '\u25A0'
    case 'dash':
      return '\u2013'
    case 'number':
      return `${n}.`
    case 'alpha':
      return `${toAlpha(n)}.`
    case 'roman':
      return `${toRoman(n)}.`
    case 'none':
      return ''
    default:
      return '\u2022'
  }
}

/** Bullet styles cycle per indent level: disc → circle → square → dash → disc … */
const BULLET_CYCLE: ListStyle[] = ['disc', 'circle', 'square', 'dash']

/** Ordered styles cycle per indent level: number → alpha → roman → number … */
const ORDERED_CYCLE: ListStyle[] = ['number', 'alpha', 'roman']

const ORDERED_STYLES = new Set<ListStyle>(['number', 'alpha', 'roman'])

/**
 * Resolve the marker for a given item accounting for its indent level.
 * Bullet-like styles cycle through disc/circle/square/dash.
 * Ordered styles cycle through number/alpha/roman.
 * Within each indent group, `groupIndex` counts from 0 for numbering.
 */
function markerForItem(
  baseStyle: ListStyle,
  indentLevel: number,
  groupIndex: number,
  startNumber: number,
): string {
  if (baseStyle === 'none') return ''
  const isOrdered = ORDERED_STYLES.has(baseStyle)
  if (isOrdered) {
    const cycle = ORDERED_CYCLE
    const baseIdx = cycle.indexOf(baseStyle)
    const effectiveStyle = cycle[(baseIdx + indentLevel) % cycle.length]
    return markerForIndex(effectiveStyle, groupIndex, startNumber)
  }
  // Bullet styles
  const cycle = BULLET_CYCLE
  const baseIdx = Math.max(0, cycle.indexOf(baseStyle))
  const effectiveStyle = cycle[(baseIdx + indentLevel) % cycle.length]
  return markerForIndex(effectiveStyle, 0, 1) // bullets don't use index
}

const MAX_INDENT = 8

// ── Resolve items ──

interface ResolvedList {
  items: string[]
  indents: number[]
}

/** Resolve the display text for a single loop-mode item. */
function resolveItemText(
  item: unknown,
  template: string,
  variableValues: Record<string, string>,
): string {
  if (typeof item === 'string') {
    return substituteVariables(template.replaceAll('{{.}}', item), variableValues)
  }
  if (item && typeof item === 'object') {
    let resolved = template
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      resolved = resolved.replaceAll(`{{${k}}}`, String(v ?? ''))
    }
    return substituteVariables(resolved, variableValues)
  }
  return String(item ?? '')
}

/**
 * Walk a JSON tree (loop mode data) and flatten into items + indents.
 * Also collects raw node references so edits can map back.
 */
function flattenJsonTree(
  data: unknown[],
  childrenKey: string,
  template: string,
  variableValues: Record<string, string>,
): { items: string[]; indents: number[]; rawNodes: unknown[] } {
  const items: string[] = []
  const indents: number[] = []
  const rawNodes: unknown[] = []

  function walk(arr: unknown[], depth: number) {
    for (const item of arr) {
      items.push(resolveItemText(item, template, variableValues))
      indents.push(depth)
      rawNodes.push(item)
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const children = (item as Record<string, unknown>)[childrenKey]
        if (Array.isArray(children) && children.length > 0) {
          walk(children, depth + 1)
        }
      }
    }
  }

  walk(data, 0)
  return { items, indents, rawNodes }
}

/**
 * Rebuild a JSON tree from flat rawNodes + (potentially changed) indents.
 * Preserves original objects/strings, just restructures the tree.
 *
 * When a string node needs children (because the next node is deeper),
 * it's promoted to `{text: "…"}`. If any promotion happens, ALL remaining
 * string nodes are also promoted so the data stays homogeneous.
 * Returns `{ tree, promoted }` so the caller can update the template.
 */
function rebuildJsonTree(
  rawNodes: unknown[],
  indents: number[],
  childrenKey: string,
): { tree: unknown[]; promoted: boolean } {
  // First pass: detect whether any string will need children
  let needsPromotion = false
  for (let i = 0; i < rawNodes.length; i++) {
    if (typeof rawNodes[i] === 'string') {
      const nextDepth = i + 1 < rawNodes.length ? (indents[i + 1] ?? 0) : 0
      if (nextDepth > (indents[i] ?? 0)) {
        needsPromotion = true
        break
      }
    }
  }

  const root: unknown[] = []
  const stack: [unknown[], number][] = [[root, -1]]

  for (let i = 0; i < rawNodes.length; i++) {
    const depth = indents[i] ?? 0
    let node: unknown = rawNodes[i]

    // Promote strings → {text} when nesting is present
    if (needsPromotion && typeof node === 'string') {
      node = { text: node }
    }

    // For objects: clone and strip old children (will be rebuilt from structure)
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      node = { ...(node as Record<string, unknown>) }
      delete (node as Record<string, unknown>)[childrenKey]
    }

    // Pop stack until we find the right parent level
    while (stack.length > 1 && stack[stack.length - 1][1] >= depth) stack.pop()

    // Add to current parent
    stack[stack.length - 1][0].push(node)

    // If it's an object, it can have children
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      const children: unknown[] = [];
      (node as Record<string, unknown>)[childrenKey] = children
      stack.push([children, depth])
    }
  }

  // Clean up empty children arrays
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
  return { tree: root, promoted: needsPromotion }
}

function resolveListItems(
  el: LayoutElement,
  variableValues: Record<string, string>,
): ResolvedList {
  // Loop mode
  if (el.dataKey) {
    const raw = variableValues[el.dataKey]
    if (!raw?.trim()) return { items: ['(no data)'], indents: [0] }
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return { items: ['(invalid data)'], indents: [0] }
      const template = el.content ?? '{{.}}'
      const childrenKey = el.listChildrenKey?.trim() || 'children'
      const flat = flattenJsonTree(parsed, childrenKey, template, variableValues)
      if (flat.items.length === 0) return { items: ['(empty)'], indents: [0] }
      return { items: flat.items, indents: flat.indents }
    } catch {
      return { items: ['(invalid JSON)'], indents: [0] }
    }
  }
  // Static mode: flatten the tree
  if (el.listItems?.length) {
    const { texts, indents } = flattenListTree(el.listItems)
    return { items: texts, indents }
  }
  return { items: [], indents: [] }
}

// ── Component ──

interface ListElementCanvasProps {
  el: LayoutElement
  isEditing?: boolean
  onCommit?: () => void
  onEscape?: () => void
}

export function ListElementCanvas({ el, isEditing, onCommit: _onCommit, onEscape }: ListElementCanvasProps) {
  const variableValues = useEditorStore((s) => s.variableValues)
  const setVariableValue = useEditorStore((s) => s.setVariableValue)
  const globalVariableDefinitions = useEditorStore((s) => s.globalVariableDefinitions)
  const pages = useEditorStore((s) => s.pages)
  const activePageIndex = useEditorStore((s) => s.activePageIndex)
  const updateElement = useEditorStore((s) => s.updateElement)
  const variableSurfaceLabelResolver = useCallback(
    (n: string) => variableMergeFieldSurfaceLabel(n, globalVariableDefinitions, pages[activePageIndex]),
    [globalVariableDefinitions, pages, activePageIndex]
  )

  const listStyle = el.listStyle ?? 'disc'
  const indent = el.listIndent ?? 16
  const spacing = el.listItemSpacing ?? 4
  const startNumber = el.listStartNumber ?? 1
  const fs = el.style?.fontSize ?? 12
  const lh = el.style?.lineHeight ?? 1.4
  const align = (el.style?.align ?? 'left') as CSSProperties['textAlign']
  const isLoopMode = !!el.dataKey

  const resolved = useMemo(() => resolveListItems(el, variableValues), [el, variableValues])
  const items = resolved.items
  const resolvedIndents = resolved.indents

  // ── Parse loop-mode JSON data (raw nodes for editing) ──
  const loopData = useMemo(() => {
    if (!isLoopMode || !el.dataKey) return null
    const raw = variableValues[el.dataKey]
    if (!raw?.trim()) return null
    try {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return null
      const childrenKey = el.listChildrenKey?.trim() || 'children'
      const template = el.content ?? '{{.}}'
      const flat = flattenJsonTree(parsed, childrenKey, template, variableValues)
      // Detect whether text is directly editable:
      // - string items: edit the string directly
      // - objects with a 'text' field: edit obj.text
      const isStringArray = flat.rawNodes.length > 0 && flat.rawNodes.every((n) => typeof n === 'string')
      const hasEditableTextField = !isStringArray && flat.rawNodes.every((n) => {
        if (typeof n === 'string') return true
        if (n && typeof n === 'object' && 'text' in (n as Record<string, unknown>)) return true
        return false
      })
      const isTextEditable = isStringArray || hasEditableTextField
      return { ...flat, isStringArray, isTextEditable, childrenKey }
    } catch {
      return null
    }
  }, [isLoopMode, el.dataKey, el.listChildrenKey, el.content, variableValues])

  // ── Editing state ──
  // Flatten the tree (static) or the JSON (loop) into flat texts + indents
  const initFlat = useMemo(() => {
    if (isLoopMode && loopData) {
      return { texts: [...loopData.items], indents: [...loopData.indents] }
    }
    if (el.listItems?.length) {
      const f = flattenListTree(el.listItems)
      return { texts: [...f.texts], indents: [...f.indents] }
    }
    return { texts: [''], indents: [0] }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Only compute once on mount

  const [editingItems, setEditingItems] = useState<string[]>(initFlat.texts)
  const [editingIndents, setEditingIndents] = useState<number[]>(initFlat.indents)
  const textareaRefs = useRef<(HTMLTextAreaElement | null)[]>([])
  const snapshotRef = useRef<{ items: string[]; indents: number[] }>({
    items: [...initFlat.texts],
    indents: [...initFlat.indents],
  })
  // For loop mode: keep reference to original raw nodes for tree reconstruction
  const loopRawNodesRef = useRef<unknown[]>(loopData?.rawNodes ? [...loopData.rawNodes] : [])
  const loopIsStringRef = useRef(loopData?.isStringArray ?? false)

  /** Auto-resize a textarea to fit its content */
  const autoResize = useCallback((ta: HTMLTextAreaElement | null) => {
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [])

  /** Auto-resize all visible textareas (e.g. after items/indents change) */
  const autoResizeAll = useCallback(() => {
    requestAnimationFrame(() => {
      for (const ta of textareaRefs.current) autoResize(ta)
    })
  }, [autoResize])

  // Auto-focus first textarea when editing starts
  useEffect(() => {
    if (!isEditing) return
    requestAnimationFrame(() => {
      const first = textareaRefs.current[0]
      if (first) {
        first.focus()
        first.setSelectionRange(first.value.length, first.value.length)
        autoResize(first)
      }
    })
  }, [isEditing, autoResize])

  // Auto-resize all textareas whenever items change
  useEffect(() => {
    autoResizeAll()
  }, [editingItems, editingIndents, autoResizeAll])

  // ── Persist helpers ──

  /** Save flat items+indents back to the element (static) or variableValues (loop). */
  const persist = useCallback(
    (newItems: string[], newIndents: number[]) => {
      setEditingItems(newItems)
      setEditingIndents(newIndents)

      if (isLoopMode && el.dataKey) {
        // Loop mode: rebuild JSON tree and write to variableValues
        const rawNodes = loopRawNodesRef.current
        // Update raw string nodes with edited text
        if (loopIsStringRef.current) {
          for (let i = 0; i < Math.min(newItems.length, rawNodes.length); i++) {
            if (typeof rawNodes[i] === 'string') {
              rawNodes[i] = newItems[i]
            }
          }
        }
        // Handle added items (Enter key): insert new string nodes
        while (rawNodes.length < newItems.length) {
          rawNodes.push(newItems[rawNodes.length])
        }
        // Handle removed items (Backspace): splice raw nodes
        if (rawNodes.length > newItems.length) {
          rawNodes.splice(newItems.length)
        }
        const childrenKey = el.listChildrenKey?.trim() || 'children'
        const { tree, promoted } = rebuildJsonTree(rawNodes, newIndents, childrenKey)
        setVariableValue(el.dataKey, JSON.stringify(tree))
        // When strings are promoted to objects, update template & raw refs
        if (promoted) {
          loopIsStringRef.current = false
          // Update raw node refs to the promoted objects
          const reFlatten = flattenJsonTree(tree, childrenKey, '{{text}}', {})
          loopRawNodesRef.current = reFlatten.rawNodes
          if (el.content === '{{.}}') {
            updateElement(el.id, { content: '{{text}}' }, { skipHistory: true })
          }
        }
      } else {
        // Static mode: build ListItemNode tree and save
        const tree = buildListTree(newItems, newIndents)
        updateElement(el.id, { listItems: tree }, { skipHistory: true })
      }
    },
    [el.id, el.dataKey, el.listChildrenKey, el.content, isLoopMode, updateElement, setVariableValue],
  )

  const handleItemChange = useCallback(
    (index: number, value: string) => {
      // Update local editing state
      const next = [...editingItems]
      next[index] = value
      setEditingItems(next)

      // Persist to store (outside of state updater to avoid side-effect issues)
      if (isLoopMode && el.dataKey) {
        const rawNodes = loopRawNodesRef.current
        // Update the raw node text
        if (typeof rawNodes[index] === 'string') {
          rawNodes[index] = value
        } else if (rawNodes[index] && typeof rawNodes[index] === 'object') {
          const obj = rawNodes[index] as Record<string, unknown>
          if ('text' in obj) obj.text = value
        }
        const childrenKey = el.listChildrenKey?.trim() || 'children'
        const { tree } = rebuildJsonTree(rawNodes, editingIndents, childrenKey)
        setVariableValue(el.dataKey, JSON.stringify(tree))
      } else {
        const tree = buildListTree(next, editingIndents)
        updateElement(el.id, { listItems: tree }, { skipHistory: true })
      }
    },
    [editingItems, el.id, el.dataKey, el.listChildrenKey, isLoopMode, editingIndents, updateElement, setVariableValue],
  )

  const focusTextarea = (idx: number, cursorEnd = true) => {
    requestAnimationFrame(() => {
      const ta = textareaRefs.current[idx]
      if (!ta) return
      ta.focus()
      if (cursorEnd) ta.setSelectionRange(ta.value.length, ta.value.length)
      autoResize(ta)
    })
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>, index: number) => {
      const ta = e.target as HTMLTextAreaElement

      if (e.key === 'Tab') {
        e.preventDefault()
        const curIndent = editingIndents[index] ?? 0
        if (e.shiftKey) {
          if (curIndent > 0) {
            const next = [...editingIndents]
            next[index] = curIndent - 1
            persist(editingItems, next)
            focusTextarea(index)
          }
        } else {
          const prevIndent = index > 0 ? (editingIndents[index - 1] ?? 0) : 0
          const maxAllowed = Math.min(MAX_INDENT, prevIndent + 1)
          if (curIndent < maxAllowed) {
            const next = [...editingIndents]
            next[index] = curIndent + 1
            persist(editingItems, next)
            focusTextarea(index)
          }
        }
      } else if (e.key === 'Enter' && e.shiftKey) {
        // Shift+Enter: soft line break within this item
        e.preventDefault()
        const start = ta.selectionStart
        const end = ta.selectionEnd
        const val = editingItems[index] ?? ''
        const newVal = val.substring(0, start) + '\n' + val.substring(end)
        const nextItems = [...editingItems]
        nextItems[index] = newVal
        persist(nextItems, editingIndents)
        requestAnimationFrame(() => {
          const ref = textareaRefs.current[index]
          if (ref) {
            ref.focus()
            const pos = start + 1
            ref.setSelectionRange(pos, pos)
            autoResize(ref)
          }
        })
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        // Insert new item after current at same indent level
        const curIndent = editingIndents[index] ?? 0
        const nextItems = [...editingItems]
        nextItems.splice(index + 1, 0, '')
        const nextIndents = [...editingIndents]
        nextIndents.splice(index + 1, 0, curIndent)
        // Also splice the raw nodes array for loop mode
        if (isLoopMode) {
          loopRawNodesRef.current.splice(index + 1, 0, '')
          loopIsStringRef.current = true // new items are always strings
        }
        persist(nextItems, nextIndents)
        focusTextarea(index + 1)
      } else if (
        e.key === 'Backspace' &&
        ta.value === '' &&
        editingItems.length > 1
      ) {
        e.preventDefault()
        const nextItems = editingItems.filter((_, i) => i !== index)
        const nextIndents = editingIndents.filter((_, i) => i !== index)
        // Also remove from raw nodes for loop mode
        if (isLoopMode) {
          loopRawNodesRef.current.splice(index, 1)
        }
        persist(nextItems, nextIndents)
        focusTextarea(Math.max(0, index - 1))
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        // Restore snapshot
        if (isLoopMode && el.dataKey) {
          // Restore the original JSON value
          const snap = snapshotRef.current
          const childrenKey = el.listChildrenKey?.trim() || 'children'
          const { tree } = rebuildJsonTree(
            loopRawNodesRef.current.slice(0, snap.items.length),
            snap.indents,
            childrenKey,
          )
          setVariableValue(el.dataKey, JSON.stringify(tree))
        } else {
          const snap = snapshotRef.current
          const tree = buildListTree(snap.items, snap.indents)
          updateElement(el.id, { listItems: tree }, { skipHistory: true })
        }
        onEscape?.()
      } else if (e.key === 'ArrowUp' && ta.selectionStart === 0 && index > 0) {
        e.preventDefault()
        focusTextarea(index - 1)
      } else if (
        e.key === 'ArrowDown' &&
        ta.selectionStart === ta.value.length &&
        index < editingItems.length - 1
      ) {
        e.preventDefault()
        focusTextarea(index + 1)
      }
    },
    [editingItems, editingIndents, persist, el.id, el.dataKey, el.listChildrenKey, isLoopMode, updateElement, setVariableValue, onEscape, autoResize],
  )

  // ── Compute per-item group indices (for numbered markers) ──
  const previewIndents = resolvedIndents.length === items.length ? resolvedIndents : items.map(() => 0)
  const computeGroupIndices = (indents: number[]) => {
    const result: number[] = []
    for (let i = 0; i < indents.length; i++) {
      const lvl = indents[i] ?? 0
      let count = 0
      for (let j = 0; j < i; j++) {
        if ((indents[j] ?? 0) === lvl) count++
        if ((indents[j] ?? 0) < lvl) count = 0
      }
      result.push(count)
    }
    return result
  }

  // ── Shared background style ──
  const bgStyle = {
    background: isValidGradient(el.style?.bgGradient)
      ? gradientToCss(el.style!.bgGradient!)
      : el.style?.backgroundColor?.trim() || undefined,
    color: el.style?.color?.trim() || undefined,
    fontFamily: coerceToSupportedFamily(el.style?.fontFamily),
  }

  // ── Editing mode (both static and loop) ──
  if (isEditing) {
    const groupIdxs = computeGroupIndices(editingIndents)
    // For loop mode with object items, text is read-only (only indent is editable)
    const textReadOnly = isLoopMode && loopData != null && !loopData.isTextEditable
    return (
      <div
        className="flex h-full w-full flex-col overflow-visible px-1 py-1"
        style={bgStyle}
      >
        {editingItems.map((item, i) => {
          const lvl = editingIndents[i] ?? 0
          const itemPadLeft = lvl * indent
          return (
            <div
              key={i}
              className="flex min-h-0 items-start"
              style={{ marginTop: i === 0 ? 0 : spacing, fontSize: fs, paddingLeft: itemPadLeft }}
            >
              {/* Marker column */}
              {listStyle !== 'none' && (
                <div
                  className="shrink-0 select-none pr-1 text-right"
                  style={{ width: indent, fontSize: fs, lineHeight: `${fs * lh}px` }}
                >
                  {markerForItem(listStyle, lvl, groupIdxs[i], startNumber)}
                </div>
              )}
              {/* Editable textarea */}
              <textarea
                ref={(r) => {
                  textareaRefs.current[i] = r
                  if (r) {
                    r.style.height = 'auto'
                    r.style.height = `${r.scrollHeight}px`
                  }
                }}
                rows={1}
                readOnly={textReadOnly}
                className={`min-w-0 flex-1 resize-none bg-transparent p-0 outline-none ${textReadOnly ? 'cursor-default' : ''}`}
                style={{
                  border: 'none',
                  boxShadow: 'none',
                  fontSize: fs,
                  lineHeight: `${fs * lh}px`,
                  fontWeight: el.style?.bold ? 700 : 400,
                  fontStyle: el.style?.italic ? 'italic' : 'normal',
                  textAlign: align,
                  color: 'inherit',
                  fontFamily: 'inherit',
                  overflow: 'hidden',
                }}
                value={item}
                onChange={(e) => {
                  if (!textReadOnly) {
                    handleItemChange(i, e.target.value)
                    autoResize(e.target)
                  }
                }}
                onKeyDown={(e) => handleKeyDown(e, i)}
                placeholder={`Item ${i + 1}`}
              />
            </div>
          )
        })}
      </div>
    )
  }

  // ── Preview mode ──
  const pvGroupIdxs = computeGroupIndices(previewIndents)
  return (
    <div
      className="pointer-events-none flex h-full w-full flex-col overflow-hidden px-1 py-1"
      style={bgStyle}
    >
      {items.map((item, i) => {
        const lvl = previewIndents[i] ?? 0
        const itemPadLeft = lvl * indent
        return (
          <div
            key={i}
            className="flex min-h-0"
            style={{ marginTop: i === 0 ? 0 : spacing, fontSize: fs, paddingLeft: itemPadLeft }}
          >
            {/* Marker column */}
            {listStyle !== 'none' && (
              <div
                className="shrink-0 select-none pr-1 text-right"
                style={{ width: indent, fontSize: fs, lineHeight: `${fs * lh}px` }}
              >
                {markerForItem(listStyle, lvl, pvGroupIdxs[i], startNumber)}
              </div>
            )}
            {/* Text column */}
            <div className="min-w-0 flex-1 overflow-hidden" style={{ lineHeight: `${fs * lh}px` }}>
              {isLoopMode ? (
                <span
                  style={{
                    fontWeight: el.style?.bold ? 700 : 400,
                    fontStyle: el.style?.italic ? 'italic' : 'normal',
                  }}
                >
                  {item}
                </span>
              ) : (
                <RichTextBlockPreview
                  content={item}
                  variableValues={variableValues}
                  variableSurfaceLabelResolver={variableSurfaceLabelResolver}
                  fontSize={fs}
                  textAlign={align}
                  elementBold={el.style?.bold}
                  elementItalic={el.style?.italic}
                  color={el.style?.color}
                  fontFamily={coerceToSupportedFamily(el.style?.fontFamily)}
                  lineHeight={lh}
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
