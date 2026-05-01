/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Local autosave interval (ms). Default 1000. Set to 0 to disable. */
  readonly VITE_EDITOR_LOCAL_SAVE_INTERVAL_MS?: string
  /** Server DRAFT sync interval (ms). Default 5000. Set to 0 to disable. */
  readonly VITE_EDITOR_DRAFT_SYNC_INTERVAL_MS?: string
  /**
   * Pixel-parity renderer kill-switch (mirrors backend `agreemint.features.pixel-parity.enabled`).
   * "true" activates the measurement-driven canvas path; anything else stays on the legacy
   * CSS-flow preview. Off by default through phases 0-4.
   */
  readonly VITE_FEATURE_PIXEL_PARITY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
