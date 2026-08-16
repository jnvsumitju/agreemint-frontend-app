/**
 * Browser-local storage for anonymous try-a-template sessions.
 *
 * <p>Two jobs: survive a reload on `/try/:slug`, and survive the trip through
 * sign-up so the visitor's work lands in their new workspace.
 *
 * <p>The second job is why this writes continuously rather than on the "Sign up
 * to save" click. Registration does not always come back to this tab —
 * verification-required accounts go via an email link, which may be opened
 * minutes later or in a different window, and OAuth returns through a full page
 * load. In-memory state survives neither, so by the time there is a session to
 * save into, the only copy left is the one on disk.
 *
 * <p>`sessionStorage` would lose the cross-tab email case, so this is
 * deliberately `localStorage`.
 */

import type { EditorState } from '../stores/editorStore'
import { snapshotFromEditorState } from './editorLocalDraft'

const DRAFTS_KEY = 'agreemint:try:drafts'
const CLAIM_KEY = 'agreemint:try:claim'
const STORAGE_V = 1 as const

/**
 * How many templates a visitor can have in-flight at once. Someone browsing the
 * gallery may open several; keeping only the newest would mean opening a second
 * template silently destroyed the edits to the first. Oldest is evicted first.
 */
const MAX_DRAFTS = 5

export interface TryDraft {
  slug: string
  /** Display name, so the claimed template is not called "Untitled". */
  name: string
  layout: Record<string, unknown>
  variableValues: Record<string, string>
  savedAt: number
}

interface DraftsFile {
  v: typeof STORAGE_V
  drafts: TryDraft[]
}

function readAll(): TryDraft[] {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Partial<DraftsFile>
    if (parsed.v !== STORAGE_V || !Array.isArray(parsed.drafts)) return []
    return parsed.drafts.filter(
      (d): d is TryDraft =>
        !!d && typeof d.slug === 'string' && !!d.layout && typeof d.layout === 'object'
    )
  } catch {
    return []
  }
}

function writeAll(drafts: TryDraft[]): void {
  const trimmed = [...drafts].sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_DRAFTS)
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify({ v: STORAGE_V, drafts: trimmed } satisfies DraftsFile))
  } catch {
    // Quota or private mode. Retry with just the newest draft — losing the
    // older ones beats losing the one being edited right now.
    try {
      localStorage.setItem(
        DRAFTS_KEY,
        JSON.stringify({ v: STORAGE_V, drafts: trimmed.slice(0, 1) } satisfies DraftsFile)
      )
    } catch {
      /* give up silently — the editor still works, it just won't survive a reload */
    }
  }
}

export function readTryDraft(slug: string): TryDraft | null {
  return readAll().find((d) => d.slug === slug) ?? null
}

export function saveTryDraft(slug: string, name: string, state: EditorState): void {
  const snap = snapshotFromEditorState(state)
  const others = readAll().filter((d) => d.slug !== slug)
  writeAll([
    ...others,
    { slug, name, layout: snap.layout, variableValues: snap.variableValues, savedAt: snap.updatedAt },
  ])
}

export function discardTryDraft(slug: string): void {
  writeAll(readAll().filter((d) => d.slug !== slug))
}

/**
 * Mark a draft as the one to save into the workspace once a session exists.
 *
 * <p>Set when the visitor asks for something that needs an account. Read after
 * authentication succeeds, by whichever route it succeeded through.
 */
export function markTryDraftForClaim(slug: string): void {
  try {
    localStorage.setItem(CLAIM_KEY, slug)
  } catch {
    /* ignore */
  }
}

export function readClaimableTryDraft(): TryDraft | null {
  let slug: string | null = null
  try {
    slug = localStorage.getItem(CLAIM_KEY)
  } catch {
    return null
  }
  if (!slug) return null
  return readTryDraft(slug)
}

export function clearTryClaim(): void {
  try {
    localStorage.removeItem(CLAIM_KEY)
  } catch {
    /* ignore */
  }
}
