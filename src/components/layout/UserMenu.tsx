import { useState, useRef, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'
import { Avatar } from '../ui/Avatar'

export function UserMenu() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)

  // Click outside + Escape to close
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setFocused(-1) }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  function handleLogout() {
    setOpen(false)
    logout()
    navigate('/login')
  }

  const menuItems = [
    { key: 'profile', label: 'Profile', href: '/profile', icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg> },
    { key: 'settings', label: 'Settings', href: '/settings', icon: <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg> },
  ] as const

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) return
    const total = menuItems.length + 1 // +1 for logout
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setFocused((f) => (f + 1) % total)
        break
      case 'ArrowUp':
        e.preventDefault()
        setFocused((f) => (f - 1 + total) % total)
        break
      case 'Enter':
        e.preventDefault()
        if (focused < menuItems.length) {
          setOpen(false)
          navigate(menuItems[focused].href)
        } else if (focused === menuItems.length) {
          handleLogout()
        }
        break
    }
  }, [open, focused, menuItems, navigate])

  return (
    <div className="relative" ref={ref} onKeyDown={onKeyDown}>
      <button
        onClick={() => { setOpen(!open); setFocused(-1) }}
        className="flex items-center rounded-full transition-opacity hover:opacity-80"
        aria-label="User menu"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Avatar
          src={user?.avatarUrl}
          name={user?.name}
          email={user?.email}
          size="sm"
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-52 rounded-xl border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 animate-in fade-in zoom-in-95 duration-150"
        >
          {user && (
            <div className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
              <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{user.name}</p>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{user.email}</p>
            </div>
          )}

          {menuItems.map((item, i) => (
            <Link
              key={item.key}
              to={item.href}
              role="menuitem"
              tabIndex={-1}
              onClick={() => setOpen(false)}
              onMouseEnter={() => setFocused(i)}
              className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors ${
                focused === i
                  ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                  : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              <span className="text-zinc-400">{item.icon}</span>
              {item.label}
            </Link>
          ))}

          <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />

          <button
            role="menuitem"
            tabIndex={-1}
            onClick={handleLogout}
            onMouseEnter={() => setFocused(menuItems.length)}
            className={`flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors ${
              focused === menuItems.length
                ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                : 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20'
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
