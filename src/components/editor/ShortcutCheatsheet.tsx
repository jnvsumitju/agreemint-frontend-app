import { useEffect, useState } from 'react'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
const mod = isMac ? '⌘' : 'Ctrl'

const SECTIONS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Selection & Navigation',
    items: [
      ['Click', 'Select element'],
      [`${mod}/Shift+Click`, 'Add to selection'],
      ['Tab / Shift+Tab', 'Cycle through elements'],
      ['Escape', 'Deselect / close inline edit'],
      ['Double-click', 'Inline edit text / open band editor'],
    ],
  },
  {
    title: 'Move & Resize',
    items: [
      ['Arrow keys', 'Nudge 1 pt'],
      ['Shift + Arrow keys', 'Nudge 10 pt'],
      ['Space + drag', 'Pan canvas'],
      ['Drag corner handle', 'Resize element'],
    ],
  },
  {
    title: 'Edit',
    items: [
      [`${mod}+Z`, 'Undo'],
      [`${mod}+Shift+Z`, 'Redo'],
      ['Delete / Backspace', 'Remove selected'],
      [`${mod}+C`, 'Copy'],
      [`${mod}+X`, 'Cut'],
      [`${mod}+V`, 'Paste'],
      [`${mod}+D`, 'Duplicate'],
    ],
  },
  {
    title: 'Text Formatting',
    items: [
      [`${mod}+B`, 'Bold'],
      [`${mod}+I`, 'Italic'],
      [`${mod}+U`, 'Underline'],
      [`${mod}+Shift+X`, 'Strikethrough'],
      [`${mod}+Enter`, 'Commit inline edit'],
    ],
  },
  {
    title: 'Zoom',
    items: [
      ['Status bar − / +', 'Zoom step'],
      ['Status bar dropdown', 'Zoom presets'],
    ],
  },
  {
    title: 'Help',
    items: [
      ['?', 'Show this cheatsheet'],
    ],
  },
]

export function ShortcutCheatsheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-600 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {section.title}
              </h3>
              <div className="flex flex-col gap-1">
                {section.items.map(([shortcut, desc]) => (
                  <div key={shortcut} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-zinc-600 dark:text-zinc-300">{desc}</span>
                    <kbd className="shrink-0 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {shortcut}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Hook to open the shortcut cheatsheet on `?` key. */
export function useShortcutCheatsheet() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.tagName === 'SELECT') return
      if (t?.isContentEditable || t?.closest('[contenteditable="true"]') || t?.closest('.ProseMirror')) return
      e.preventDefault()
      setOpen((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return { open, setOpen, onClose: () => setOpen(false) }
}
