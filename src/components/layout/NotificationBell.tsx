import { useCallback, useEffect, useRef, useState } from 'react'
import { authFetch } from '../../lib/api'

interface NotificationDto {
  id: string
  type: string
  title: string
  body: string | null
  entityType: string | null
  entityId: string | null
  read: boolean
  createdAt: string
}

/** Bell icon with unread badge + dropdown panel showing recent notifications. */
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationDto[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const fetchUnread = useCallback(async () => {
    try {
      const res = await authFetch('/api/notifications/unread')
      if (res.ok) {
        const data = await res.json()
        setUnreadCount(data.count ?? 0)
      }
    } catch { /* ignore */ }
  }, [])

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await authFetch('/api/notifications?limit=15')
      if (res.ok) {
        const data = await res.json()
        setNotifications(data)
      }
    } catch { /* ignore */ }
  }, [])

  // Poll unread count every 30s
  useEffect(() => {
    fetchUnread()
    const interval = setInterval(fetchUnread, 30000)
    return () => clearInterval(interval)
  }, [fetchUnread])

  // Load full list when opened
  useEffect(() => {
    if (open) fetchNotifications()
  }, [open, fetchNotifications])

  // Click outside to close
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const markRead = async (id: string) => {
    await authFetch(`/api/notifications/${id}/read`, { method: 'POST' })
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    setUnreadCount((c) => Math.max(0, c - 1))
  }

  const markAllRead = async () => {
    await authFetch('/api/notifications/read-all', { method: 'POST' })
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnreadCount(0)
  }

  const typeIcon = (type: string) => {
    switch (type) {
      case 'COMMENT_MENTION':
        return '💬'
      case 'REVIEW_REQUEST':
        return '📋'
      case 'TEMPLATE_SHARED':
        return '📄'
      case 'MEMBER_INVITE':
        return '👤'
      default:
        return '🔔'
    }
  }

  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="relative flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-[300] mt-1 w-80 rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-600 dark:bg-zinc-900">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 dark:border-zinc-700">
            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                className="text-[10px] font-medium text-violet-600 hover:text-violet-800 dark:text-violet-400"
                onClick={markAllRead}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-zinc-400">No notifications yet</p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                    !n.read ? 'bg-violet-50/50 dark:bg-violet-900/10' : ''
                  }`}
                  onClick={() => { if (!n.read) markRead(n.id) }}
                >
                  <span className="mt-0.5 text-sm">{typeIcon(n.type)}</span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-[11px] leading-snug ${!n.read ? 'font-medium text-zinc-900 dark:text-zinc-100' : 'text-zinc-600 dark:text-zinc-400'}`}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="mt-0.5 truncate text-[10px] text-zinc-500 dark:text-zinc-500">{n.body}</p>
                    )}
                    <p className="mt-0.5 text-[9px] text-zinc-400">{timeAgo(n.createdAt)}</p>
                  </div>
                  {!n.read && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet-500" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
