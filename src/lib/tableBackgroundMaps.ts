/** Persisted TABLE row/column fill maps use string keys: "-1" = header row, "0"… = data row / column indices. */

export function reindexColumnBackgroundsAfterDelete(
  map: Record<string, string> | undefined,
  removedSortedAsc: number[]
): Record<string, string> | undefined {
  if (!map || !Object.keys(map).length || !removedSortedAsc.length) return map
  const removeSet = new Set(removedSortedAsc)
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) {
    const i = Number(k)
    if (!Number.isFinite(i) || removeSet.has(i)) continue
    const dec = removedSortedAsc.filter((r) => r < i).length
    next[String(i - dec)] = v
  }
  return Object.keys(next).length ? next : undefined
}

export function shiftColumnBackgroundsAfterInsert(
  map: Record<string, string> | undefined,
  insertIndex: number
): Record<string, string> | undefined {
  if (!map || !Object.keys(map).length) return map
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) {
    const i = Number(k)
    if (!Number.isFinite(i)) continue
    if (i >= insertIndex) next[String(i + 1)] = v
    else next[String(i)] = v
  }
  return Object.keys(next).length ? next : undefined
}

export function reindexRowBackgroundsAfterDelete(
  map: Record<string, string> | undefined,
  removedSortedAsc: number[]
): Record<string, string> | undefined {
  if (!map || !Object.keys(map).length || !removedSortedAsc.length) return map
  const removeSet = new Set(removedSortedAsc)
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) {
    if (k === '-1') {
      next['-1'] = v
      continue
    }
    const i = Number(k)
    if (!Number.isFinite(i) || removeSet.has(i)) continue
    const dec = removedSortedAsc.filter((r) => r < i).length
    next[String(i - dec)] = v
  }
  return Object.keys(next).length ? next : undefined
}

export function shiftRowBackgroundsAfterInsert(
  map: Record<string, string> | undefined,
  insertIndex: number
): Record<string, string> | undefined {
  if (!map || !Object.keys(map).length) return map
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) {
    if (k === '-1') {
      next['-1'] = v
      continue
    }
    const i = Number(k)
    if (!Number.isFinite(i)) continue
    if (i >= insertIndex) next[String(i + 1)] = v
    else next[String(i)] = v
  }
  return Object.keys(next).length ? next : undefined
}

export function duplicateColumnBackgroundMap(
  map: Record<string, string> | undefined,
  srcIndex: number
): Record<string, string> | undefined {
  if (!map || !Object.keys(map).length) return map
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) {
    const i = Number(k)
    if (!Number.isFinite(i)) continue
    if (i <= srcIndex) next[String(i)] = v
    else next[String(i + 1)] = v
  }
  const copy = map[String(srcIndex)]?.trim()
  if (copy) next[String(srcIndex + 1)] = copy
  return Object.keys(next).length ? next : undefined
}

export function swapColumnBackgroundKeys(
  map: Record<string, string> | undefined,
  i: number,
  j: number
): Record<string, string> | undefined {
  if (!map || !Object.keys(map).length) return map
  const a = map[String(i)]?.trim()
  const b = map[String(j)]?.trim()
  const next = { ...map }
  if (b) next[String(i)] = b
  else delete next[String(i)]
  if (a) next[String(j)] = a
  else delete next[String(j)]
  return Object.keys(next).length ? next : undefined
}

function parseCellKey(k: string): { row: number; col: number } | null {
  const m = k.match(/^(-?\d+),(\d+)$/)
  if (!m) return null
  return { row: Number(m[1]), col: Number(m[2]) }
}

export function shiftCellBackgroundsAfterColumnInsert(
  map: Record<string, string> | undefined,
  insertCol: number
): Record<string, string> | undefined {
  if (!map || !Object.keys(map).length) return map
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) {
    const c = parseCellKey(k)
    if (!c) continue
    if (c.col >= insertCol) next[`${c.row},${c.col + 1}`] = v
    else next[k] = v
  }
  return Object.keys(next).length ? next : undefined
}

export function shiftCellBackgroundsAfterRowInsert(
  map: Record<string, string> | undefined,
  insertRow: number
): Record<string, string> | undefined {
  if (!map || !Object.keys(map).length) return map
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) {
    const c = parseCellKey(k)
    if (!c) continue
    if (c.row === -1) { next[k] = v; continue }
    if (c.row >= insertRow) next[`${c.row + 1},${c.col}`] = v
    else next[k] = v
  }
  return Object.keys(next).length ? next : undefined
}

export function reindexCellBackgroundsAfterColumnDelete(
  map: Record<string, string> | undefined,
  removedCols: number[]
): Record<string, string> | undefined {
  if (!map || !Object.keys(map).length || !removedCols.length) return map
  const removeSet = new Set(removedCols)
  const sorted = [...removedCols].sort((a, b) => a - b)
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) {
    const c = parseCellKey(k)
    if (!c || removeSet.has(c.col)) continue
    const dec = sorted.filter((r) => r < c.col).length
    next[`${c.row},${c.col - dec}`] = v
  }
  return Object.keys(next).length ? next : undefined
}

export function reindexCellBackgroundsAfterRowDelete(
  map: Record<string, string> | undefined,
  removedRows: number[]
): Record<string, string> | undefined {
  if (!map || !Object.keys(map).length || !removedRows.length) return map
  const removeSet = new Set(removedRows)
  const sorted = [...removedRows].sort((a, b) => a - b)
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) {
    const c = parseCellKey(k)
    if (!c || removeSet.has(c.row)) continue
    if (c.row === -1) { next[k] = v; continue }
    const dec = sorted.filter((r) => r < c.row).length
    next[`${c.row - dec},${c.col}`] = v
  }
  return Object.keys(next).length ? next : undefined
}

export function swapCellBackgroundColumns(
  map: Record<string, string> | undefined,
  i: number,
  j: number
): Record<string, string> | undefined {
  if (!map || !Object.keys(map).length) return map
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) {
    const c = parseCellKey(k)
    if (!c) continue
    if (c.col === i) next[`${c.row},${j}`] = v
    else if (c.col === j) next[`${c.row},${i}`] = v
    else next[k] = v
  }
  return Object.keys(next).length ? next : undefined
}

export function duplicateCellBackgroundColumn(
  map: Record<string, string> | undefined,
  srcCol: number
): Record<string, string> | undefined {
  if (!map || !Object.keys(map).length) return map
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(map)) {
    const c = parseCellKey(k)
    if (!c) continue
    if (c.col <= srcCol) next[k] = v
    else next[`${c.row},${c.col + 1}`] = v
  }
  for (const [k, v] of Object.entries(map)) {
    const c = parseCellKey(k)
    if (c && c.col === srcCol) next[`${c.row},${srcCol + 1}`] = v
  }
  return Object.keys(next).length ? next : undefined
}
