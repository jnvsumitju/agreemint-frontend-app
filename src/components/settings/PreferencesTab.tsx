import { useState, useSyncExternalStore } from 'react'
import {
  getDarkModePreference,
  setDarkModePreference,
  subscribeDarkMode,
  type DarkModeValue,
} from '../../lib/darkMode'
import { usePermissions } from '../../hooks/usePermissions'

const GRID_KEY = 'agreemint-grid-default-size'
const AUTOSAVE_KEY = 'agreemint-autosave-interval'

function getGridSize(): number {
  try {
    const v = localStorage.getItem(GRID_KEY)
    if (v) return Number(v)
  } catch { /* private browsing */ }
  return 12
}

function getAutoSaveInterval(): number {
  try {
    const v = localStorage.getItem(AUTOSAVE_KEY)
    if (v) return Number(v)
  } catch { /* private browsing */ }
  return 30
}

export function PreferencesTab() {
  const { canEdit } = usePermissions()
  const darkMode = useSyncExternalStore(subscribeDarkMode, getDarkModePreference)
  const [gridSize, setGridSize] = useState(getGridSize)
  const [autoSave, setAutoSave] = useState(getAutoSaveInterval)
  const [toast, setToast] = useState<{ type: 'success'; msg: string } | null>(null)

  function showToast(msg: string) {
    setToast({ type: 'success', msg })
    setTimeout(() => setToast(null), 3000)
  }

  function handleDarkMode(value: DarkModeValue) {
    setDarkModePreference(value)
  }

  function handleGridSize(value: number) {
    setGridSize(value)
    try {
      localStorage.setItem(GRID_KEY, String(value))
    } catch { /* private browsing */ }
    showToast('Grid size updated')
  }

  function handleAutoSave(value: number) {
    setAutoSave(value)
    try {
      localStorage.setItem(AUTOSAVE_KEY, String(value))
    } catch { /* private browsing */ }
    showToast('Auto-save interval updated')
  }

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div className="fixed right-4 top-16 z-50 rounded-lg bg-green-50 px-4 py-2.5 text-sm font-medium text-green-700 shadow-lg dark:bg-green-900/30 dark:text-green-300">
          {toast.msg}
        </div>
      )}

      {/* Appearance */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-medium text-zinc-900 dark:text-zinc-100">Appearance</h2>

        <div>
          <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Theme
          </label>
          <div className="flex gap-2">
            {(['light', 'dark', 'system'] as DarkModeValue[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => handleDarkMode(option)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium capitalize transition-colors ${
                  darkMode === option
                    ? 'border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-400 dark:bg-violet-900/30 dark:text-violet-300'
                    : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                }`}
              >
                {option === 'light' && (
                  <span className="mr-1.5 inline-block">
                    <svg className="inline h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </span>
                )}
                {option === 'dark' && (
                  <span className="mr-1.5 inline-block">
                    <svg className="inline h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                  </span>
                )}
                {option === 'system' && (
                  <span className="mr-1.5 inline-block">
                    <svg className="inline h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </span>
                )}
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Editor defaults — only visible for users who can edit */}
      {canEdit && (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-medium text-zinc-900 dark:text-zinc-100">Editor defaults</h2>

        <div className="space-y-5">
          {/* Grid size */}
          <div>
            <label
              htmlFor="grid-size"
              className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Grid default size (px)
            </label>
            <div className="flex items-center gap-3">
              <input
                id="grid-size"
                type="range"
                min={4}
                max={48}
                step={4}
                value={gridSize}
                onChange={(e) => handleGridSize(Number(e.target.value))}
                className="flex-1 accent-violet-600"
              />
              <span className="w-10 text-right text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {gridSize}
              </span>
            </div>
          </div>

          {/* Auto-save interval */}
          <div>
            <label
              htmlFor="autosave"
              className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              Auto-save interval (seconds)
            </label>
            <select
              id="autosave"
              value={autoSave}
              onChange={(e) => handleAutoSave(Number(e.target.value))}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-violet-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
            >
              <option value={10}>10 seconds</option>
              <option value={15}>15 seconds</option>
              <option value={30}>30 seconds (default)</option>
              <option value={60}>1 minute</option>
              <option value={120}>2 minutes</option>
              <option value={0}>Disabled</option>
            </select>
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
