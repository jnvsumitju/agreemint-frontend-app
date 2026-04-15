import { useCallback, useEffect, useState } from 'react'
import { authFetch } from '../../lib/api'
import { useAuthStore } from '../../stores/authStore'

interface ActivityEntry {
  id: string
  action: string
  entityType: string
  entityId: string | null
  entityName: string | null
  userName: string | null
  createdAt: string
}

/** Editor sidebar tab showing recent activity for the current org. */
export function ActivityTab() {
  const org = useAuthStore((s) => s.org)
  const [activities, setActivities] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!org) return
    setLoading(true)
    try {
      const res = await authFetch('/api/activity?limit=30')
      if (res.ok) {
        const data = await res.json()
        setActivities(data)
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [org])

  useEffect(() => { load() }, [load])

  const actionIcon = (action: string) => {
    switch (action) {
      case 'CREATED': return '🆕'
      case 'UPDATED': return '✏️'
      case 'DELETED': return '🗑️'
      case 'COMMITTED': return '📦'
      case 'PUBLISHED': return '🚀'
      case 'COMMENTED': return '💬'
      case 'MEMBER_ADDED': return '👤'
      case 'MEMBER_REMOVED': return '👋'
      default: return '📋'
    }
  }

  const actionLabel = (action: string) => {
    switch (action) {
      case 'CREATED': return 'created'
      case 'UPDATED': return 'updated'
      case 'DELETED': return 'deleted'
      case 'COMMITTED': return 'committed'
      case 'PUBLISHED': return 'published'
      case 'COMMENTED': return 'commented on'
      case 'MEMBER_ADDED': return 'added member to'
      case 'MEMBER_REMOVED': return 'removed member from'
      default: return action.toLowerCase()
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
    if (days < 7) return `${days}d ago`
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Activity</p>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Activity
        </p>
        <button
          type="button"
          className="text-[9px] text-violet-600 hover:text-violet-800 dark:text-violet-400"
          onClick={load}
        >
          Refresh
        </button>
      </div>

      {activities.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-400">No activity yet</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {activities.map((a) => (
            <li
              key={a.id}
              className="flex items-start gap-2 rounded-lg border border-zinc-100 p-2 text-[11px] dark:border-zinc-700"
            >
              <span className="mt-0.5 shrink-0 text-sm">{actionIcon(a.action)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-zinc-700 dark:text-zinc-300">
                  <span className="font-medium">{a.userName ?? 'System'}</span>
                  {' '}
                  {actionLabel(a.action)}
                  {' '}
                  {a.entityName && (
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{a.entityName}</span>
                  )}
                </p>
                <p className="mt-0.5 text-[9px] text-zinc-400">{timeAgo(a.createdAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
