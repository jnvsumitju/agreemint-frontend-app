/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Local autosave interval (ms). Default 1000. Set to 0 to disable. */
  readonly VITE_EDITOR_LOCAL_SAVE_INTERVAL_MS?: string
  /** Server DRAFT sync interval (ms). Default 5000. Set to 0 to disable. */
  readonly VITE_EDITOR_DRAFT_SYNC_INTERVAL_MS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
