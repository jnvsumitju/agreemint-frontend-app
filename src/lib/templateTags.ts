/**
 * localStorage-backed template tag store.
 * Tags are stored as a map of templateId → string[] in localStorage.
 * When the backend adds tag support, this can be swapped out.
 */

const STORAGE_KEY = 'agreemint-template-tags'

type TagMap = Record<string, string[]>

function readTagMap(): TagMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as TagMap
  } catch {
    return {}
  }
}

function writeTagMap(map: TagMap): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
}

/** Get tags for a specific template. */
export function getTemplateTags(templateId: string): string[] {
  return readTagMap()[templateId] ?? []
}

/** Set tags for a specific template (replaces existing). */
export function setTemplateTags(templateId: string, tags: string[]): void {
  const map = readTagMap()
  if (tags.length === 0) {
    delete map[templateId]
  } else {
    map[templateId] = tags
  }
  writeTagMap(map)
}

/** Add a single tag to a template (no duplicates). */
export function addTemplateTag(templateId: string, tag: string): void {
  const trimmed = tag.trim().toLowerCase()
  if (!trimmed) return
  const map = readTagMap()
  const existing = map[templateId] ?? []
  if (existing.includes(trimmed)) return
  map[templateId] = [...existing, trimmed]
  writeTagMap(map)
}

/** Remove a single tag from a template. */
export function removeTemplateTag(templateId: string, tag: string): void {
  const map = readTagMap()
  const existing = map[templateId] ?? []
  const next = existing.filter((t) => t !== tag)
  if (next.length === 0) {
    delete map[templateId]
  } else {
    map[templateId] = next
  }
  writeTagMap(map)
}

/** Get all unique tags used across all templates, sorted. */
export function allUsedTags(): string[] {
  const map = readTagMap()
  const set = new Set<string>()
  for (const tags of Object.values(map)) {
    for (const t of tags) set.add(t)
  }
  return [...set].sort()
}

/** Get full tag map (for bulk display on gallery). */
export function getAllTemplateTags(): TagMap {
  return readTagMap()
}

/** Remove all tags for a template (cleanup on delete). */
export function clearTemplateTags(templateId: string): void {
  const map = readTagMap()
  delete map[templateId]
  writeTagMap(map)
}

/** Suggested default tags for quick-add UI. */
export const SUGGESTED_TAGS = [
  'invoice',
  'contract',
  'nda',
  'proposal',
  'report',
  'letter',
  'receipt',
  'agreement',
  'form',
  'certificate',
] as const
