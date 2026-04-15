import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchTemplates, type TemplateDto } from '../../lib/api'

/* ── Types ── */

interface CommandItem {
  id: string
  label: string
  description?: string
  icon: React.ReactNode
  action: () => void
  section: string
}

/* ── Component ── */

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [templates, setTemplates] = useState<TemplateDto[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // Load templates for search
  useEffect(() => {
    if (open && templates.length === 0) {
      fetchTemplates().then(setTemplates).catch(() => {})
    }
  }, [open, templates.length])

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Lock body scroll
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Navigation items
  const navigationItems: CommandItem[] = useMemo(() => [
    {
      id: 'nav-templates', label: 'Templates', description: 'View all templates',
      icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>,
      action: () => navigate('/'), section: 'Navigation',
    },
    {
      id: 'nav-dashboard', label: 'Dashboard', description: 'View dashboard',
      icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>,
      action: () => navigate('/dashboard'), section: 'Navigation',
    },
    {
      id: 'nav-marketplace', label: 'Marketplace', description: 'Browse templates',
      icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72" /></svg>,
      action: () => navigate('/marketplace'), section: 'Navigation',
    },
    {
      id: 'nav-settings', label: 'Settings', description: 'Manage workspace',
      icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
      action: () => navigate('/settings'), section: 'Navigation',
    },
    {
      id: 'nav-profile', label: 'Profile', description: 'Your account',
      icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>,
      action: () => navigate('/profile'), section: 'Navigation',
    },
  ], [navigate])

  // Template items
  const templateItems: CommandItem[] = useMemo(() =>
    templates.map((t) => ({
      id: `template-${t.id}`,
      label: t.name,
      description: 'Open in editor',
      icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>,
      action: () => navigate(`/editor/${t.id}`),
      section: 'Templates',
    })),
  [templates, navigate])

  // All items filtered
  const allItems = useMemo(() => {
    const all = [...navigationItems, ...templateItems]
    if (!query.trim()) return all.slice(0, 12)
    const q = query.toLowerCase()
    return all.filter((item) =>
      item.label.toLowerCase().includes(q) || item.description?.toLowerCase().includes(q)
    ).slice(0, 12)
  }, [query, navigationItems, templateItems])

  // Group by section
  const sections = useMemo(() => {
    const map = new Map<string, CommandItem[]>()
    for (const item of allItems) {
      const list = map.get(item.section) ?? []
      list.push(item)
      map.set(item.section, list)
    }
    return Array.from(map.entries())
  }, [allItems])

  const flatItems = allItems

  const runItem = useCallback((item: CommandItem) => {
    setOpen(false)
    item.action()
  }, [])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelected((s) => (s + 1) % flatItems.length)
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelected((s) => (s - 1 + flatItems.length) % flatItems.length)
        break
      case 'Enter':
        e.preventDefault()
        if (flatItems[selected]) runItem(flatItems[selected])
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        break
    }
  }, [flatItems, selected, runItem])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[9998] flex items-start justify-center pt-[15vh]" role="presentation">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setOpen(false)} />

      {/* Palette */}
      <div className="relative w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 animate-in zoom-in-95 fade-in duration-150">
        {/* Search */}
        <div className="flex items-center gap-3 border-b border-zinc-100 px-4 dark:border-zinc-800">
          <svg className="h-5 w-5 shrink-0 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent py-3.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            placeholder="Search templates, pages, actions…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0) }}
            onKeyDown={onKeyDown}
          />
          <kbd className="hidden rounded border border-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 dark:border-zinc-700 sm:inline">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[300px] overflow-y-auto p-2">
          {allItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-500">
              No results for "{query}"
            </p>
          ) : (
            sections.map(([section, items]) => (
              <div key={section}>
                <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  {section}
                </p>
                {items.map((item) => {
                  const idx = flatItems.indexOf(item)
                  return (
                    <button
                      key={item.id}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        idx === selected
                          ? 'bg-violet-50 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300'
                          : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                      }`}
                      onClick={() => runItem(item)}
                      onMouseEnter={() => setSelected(idx)}
                    >
                      <span className="shrink-0 text-zinc-400">{item.icon}</span>
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.description && (
                        <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">{item.description}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-2 dark:border-zinc-800">
          <div className="flex items-center gap-3 text-[10px] text-zinc-400 dark:text-zinc-500">
            <span><kbd className="rounded border border-zinc-200 px-1 dark:border-zinc-700">↑↓</kbd> navigate</span>
            <span><kbd className="rounded border border-zinc-200 px-1 dark:border-zinc-700">↵</kbd> open</span>
            <span><kbd className="rounded border border-zinc-200 px-1 dark:border-zinc-700">esc</kbd> close</span>
          </div>
        </div>
      </div>
    </div>
  )
}
