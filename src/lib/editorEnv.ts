function parseMs(raw: string | undefined, fallback: number): number {
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Interval for writing editor state to localStorage (ms). `0` = disabled. */
export function editorLocalSaveIntervalMs(): number {
  return parseMs(import.meta.env.VITE_EDITOR_LOCAL_SAVE_INTERVAL_MS, 1000)
}

/**
 * Interval for syncing DRAFT to the backend (ms). `0` = disabled (default).
 *
 * Disabled by default because the collaborative editor (src/collab/*) is now
 * the authoritative save path — ops flow via STOMP and the backend flushes the
 * hot Redis layout to Postgres every 5s. Leaving this enabled would race the
 * collab path and clobber remote ops.
 *
 * Only set VITE_EDITOR_DRAFT_SYNC_INTERVAL_MS > 0 if the collab transport is
 * temporarily disabled (e.g. Redis unavailable) as a safety-net fallback.
 */
export function editorDraftSyncIntervalMs(): number {
  return parseMs(import.meta.env.VITE_EDITOR_DRAFT_SYNC_INTERVAL_MS, 0)
}
