import { useEffect, useState } from 'react'
import { Modal } from '../ui/Modal'

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
  return (
    <Modal open={open} onClose={onClose} title="Keyboard Shortcuts" size="lg">
      <div className="grid gap-5 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {section.title}
            </h3>
            <div className="flex flex-col gap-1.5">
              {section.items.map(([shortcut, desc]) => (
                <div key={shortcut} className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="text-zinc-600 dark:text-zinc-300">{desc}</span>
                  <kbd className="shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[10px] font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {shortcut}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
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
