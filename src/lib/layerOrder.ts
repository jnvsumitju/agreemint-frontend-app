/**
 * Reorder ids in a list where `ids` order is **display** order (e.g. front → back).
 * Removes `fromId` then inserts before/after `targetId`.
 */
export function reorderIdsInList(
  ids: string[],
  fromId: string,
  targetId: string,
  position: 'before' | 'after'
): string[] {
  if (fromId === targetId) return ids
  const from = ids.indexOf(fromId)
  const t = ids.indexOf(targetId)
  if (from < 0 || t < 0) return ids
  let insert = position === 'before' ? t : t + 1
  const next = [...ids]
  next.splice(from, 1)
  if (from < insert) insert -= 1
  next.splice(insert, 0, fromId)
  return next
}
