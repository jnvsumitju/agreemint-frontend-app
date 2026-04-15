import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { authFetch } from '../../lib/api'
import { useAuthStore } from '../../stores/authStore'
import { Avatar } from '../ui/Avatar'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { SkeletonRow } from '../ui/Skeleton'

interface ActivityEntry {
  id: string
  action: string
  entityType: string
  entityId: string | null
  entityName: string | null
  userName: string | null
  createdAt: string
}

/* ── Action icons (SVG, replacing emoji) ── */

const actionIcons: Record<string, { icon: ReactNode; badge: 'success' | 'info' | 'danger' | 'warning' | 'primary' | 'default' }> = {
  CREATED:        { badge: 'success', icon: <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg> },
  UPDATED:        { badge: 'info', icon: <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg> },
  DELETED:        { badge: 'danger', icon: <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg> },
  COMMITTED:      { badge: 'primary', icon: <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
  PUBLISHED:      { badge: 'success', icon: <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg> },
  COMMENTED:      { badge: 'info', icon: <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg> },
  MEMBER_ADDED:   { badge: 'success', icon: <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" /></svg> },
  MEMBER_REMOVED: { badge: 'warning', icon: <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M22 10.5h-6m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" /></svg> },
}

const defaultActionIcon = { badge: 'default' as const, icon: <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg> }

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

function dateGroup(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return 'This week'
  return 'Earlier'
}

export function ActivityTab() {
  const org = useAuthStore((s) => s.org)
  const [activities, setActivities] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!org) return
    setLoading(true)
    try {
      const res = await authFetch('/api/activity?limit=30')
      if (res.ok) setActivities(await res.json())
    } catch (err) {
      console.error('[ActivityTab] Failed to load:', err)
    }
    setLoading(false)
  }, [org])

  useEffect(() => { load() }, [load])

  // Group by date
  const groups: { label: string; items: ActivityEntry[] }[] = []
  for (const a of activities) {
    const g = dateGroup(a.createdAt)
    const existing = groups.find((gr) => gr.label === g)
    if (existing) existing.items.push(a)
    else groups.push({ label: g, items: [a] })
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Activity</p>
        {[1, 2, 3, 4].map((i) => <SkeletonRow key={i} />)}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Activity</span>
        <Button variant="ghost" size="xs" onClick={load}>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
        </Button>
      </div>

      {activities.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Activity from your team will appear here"
          icon={<svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          className="py-6"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-300 dark:text-zinc-600">
                {group.label}
              </p>
              <div className="space-y-1">
                {group.items.map((a) => {
                  const { badge, icon } = actionIcons[a.action] ?? defaultActionIcon
                  return (
                    <div
                      key={a.id}
                      className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    >
                      <Avatar name={a.userName ?? 'System'} size="xs" className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] text-zinc-700 dark:text-zinc-300 lg:text-[11px]">
                          <span className="font-medium">{a.userName ?? 'System'}</span>
                          {' '}{actionLabel(a.action)}{' '}
                          {a.entityName && <span className="font-medium text-zinc-900 dark:text-zinc-100">{a.entityName}</span>}
                        </p>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <Badge variant={badge} size="sm" icon={icon}>{a.action.toLowerCase()}</Badge>
                          <span className="text-[9px] text-zinc-400 dark:text-zinc-500">{timeAgo(a.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
