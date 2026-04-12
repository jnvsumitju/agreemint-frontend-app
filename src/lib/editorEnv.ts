function parseMs(raw: string | undefined, fallback: number): number {
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Interval for writing editor state to localStorage (ms). `0` = disabled. */
export function editorLocalSaveIntervalMs(): number {
  return parseMs(import.meta.env.VITE_EDITOR_LOCAL_SAVE_INTERVAL_MS, 1000)
}

/** Interval for syncing DRAFT to the backend (ms). `0` = disabled. */
export function editorDraftSyncIntervalMs(): number {
  return parseMs(import.meta.env.VITE_EDITOR_DRAFT_SYNC_INTERVAL_MS, 5000)
}
