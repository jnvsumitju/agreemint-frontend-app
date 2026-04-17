import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authFetch } from '../lib/api'
import { Card, CardContent, CardHeader } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'

/**
 * Full-page notifications inbox. Shares the wire shape with NotificationBell
 * but renders more items and shows body + entity context.
 */

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

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function resolveTarget(n: NotificationDto): string | null {
  if (n.entityType === 'TEMPLATE' && n.entityId) {
    switch (n.type) {
      case 'REVIEW_REQUEST':
      case 'REVIEW_APPROVED':
      case 'REVIEW_CHANGES_REQUESTED':
      case 'REVIEW_REOPENED':
      case 'REVIEW_DISMISSED':
        return `/editor/${n.entityId}?tab=reviews`
      case 'COMMENT_MENTION':
        return `/editor/${n.entityId}?tab=comments`
      case 'TEMPLATE_SHARED':
      default:
        return `/editor/${n.entityId}`
    }
  }
  if (n.entityType === 'DOCUMENT' && n.entityId) {
    return `/documents/${n.entityId}`
  }
  return null
}

const typeColors: Record<string, string> = {
  COMMENT_MENTION: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  REVIEW_REQUEST: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  REVIEW_APPROVED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  REVIEW_CHANGES_REQUESTED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  REVIEW_REOPENED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  REVIEW_DISMISSED: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  TEMPLATE_SHARED: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  MEMBER_INVITE: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
}

function TypeBadge({ type }: { type: string }): ReactNode {
  const cls = typeColors[type] ?? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
  const label = type
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>
  )
}

export function Notifications() {
  const navigate = useNavigate()
  const [items, setItems] = useState<NotificationDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch('/api/notifications?limit=100')
      if (!res.ok) throw new Error(`Failed to load (${res.status})`)
      setItems(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(
    () => (filter === 'unread' ? items.filter((i) => !i.read) : items),
    [items, filter],
  )

  async function markAllRead() {
    try {
      await authFetch('/api/notifications/read-all', { method: 'POST' })
      setItems((prev) => prev.map((n) => ({ ...n, read: true })))
    } catch { /* silent */ }
  }

  async function handleClick(n: NotificationDto) {
    if (!n.read) {
      try {
        await authFetch(`/api/notifications/${n.id}/read`, { method: 'POST' })
        setItems((prev) => prev.map((p) => (p.id === n.id ? { ...p, read: true } : p)))
      } catch { /* ignore — navigation is more important */ }
    }
    const target = resolveTarget(n)
    if (target) navigate(target)
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Notifications</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Everything that's needed your attention recently.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
            {(['all', 'unread'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  filter === k
                    ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                {k === 'all' ? 'All' : 'Unread'}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Mark all read
          </button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <span className="text-sm font-semibold">
            {filter === 'unread' ? `Unread (${visible.length})` : `Recent (${visible.length})`}
          </span>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-sm text-zinc-400">Loading…</div>
          ) : error ? (
            <div className="py-8 text-center text-sm text-red-500">{error}</div>
          ) : visible.length === 0 ? (
            <EmptyState
              title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
              description={filter === 'unread' ? "You're all caught up." : "When people share templates or request your review, they'll appear here."}
            />
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {visible.map((n) => {
                const target = resolveTarget(n)
                const RowContent = (
                  <div className={`flex items-start gap-3 px-1 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60 ${!n.read ? 'bg-violet-50/40 dark:bg-violet-900/5' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <TypeBadge type={n.type} />
                        <span className={`truncate text-sm ${!n.read ? 'font-medium text-zinc-900 dark:text-zinc-100' : 'text-zinc-700 dark:text-zinc-300'}`}>
                          {n.title}
                        </span>
                      </div>
                      {n.body && (
                        <p className="mt-0.5 text-[12px] text-zinc-500 dark:text-zinc-400">{n.body}</p>
                      )}
                      <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">{timeAgo(n.createdAt)}</p>
                    </div>
                    {!n.read && (
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-violet-500" aria-label="Unread" />
                    )}
                  </div>
                )
                return (
                  <li key={n.id}>
                    {target ? (
                      <Link
                        to={target}
                        onClick={(e) => {
                          // Still hit the markRead endpoint for correctness even though
                          // Link will navigate. Let navigation proceed.
                          if (!n.read) {
                            e.preventDefault()
                            void handleClick(n)
                          }
                        }}
                        className="block"
                      >
                        {RowContent}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="block w-full text-left"
                        onClick={() => void handleClick(n)}
                      >
                        {RowContent}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
