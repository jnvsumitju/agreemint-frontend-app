import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { authFetch, type TemplateDto } from '../lib/api'
import { useAuthStore } from '../stores/authStore'

/* ── Types ── */

interface ActivityItem {
  id: string
  action: string
  entityType: string
  entityId: string | null
  entityName: string | null
  userName: string | null
  createdAt: string
}

interface OrgMember {
  id: string
  userId: string
  role: string
  userName: string
}

/* ── Helpers ── */

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(iso)
}

function actionIcon(action: string) {
  switch (action.toLowerCase()) {
    case 'created':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-500">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      )
    case 'updated':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      )
    case 'deleted':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-500">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      )
    case 'published':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-violet-500">
          <path d="M22 2L11 13" />
          <path d="M22 2L15 22l-4-9-9-4 20-7z" />
        </svg>
      )
    default:
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-400">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      )
  }
}

/* ── Stat Card ── */

function StatCard({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>
      {loading ? (
        <div className="mt-2 h-7 w-16 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
      ) : (
        <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</p>
      )}
    </div>
  )
}

/* ── Main Dashboard ── */

export function Dashboard() {
  const { user, org, orgs } = useAuthStore()

  const [templates, setTemplates] = useState<TemplateDto[]>([])
  const [members, setMembers] = useState<OrgMember[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [loadingStats, setLoadingStats] = useState(true)
  const [loadingActivity, setLoadingActivity] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function fetchStats() {
      try {
        const [templatesRes, membersRes] = await Promise.all([
          authFetch('/api/templates'),
          org ? authFetch(`/api/orgs/${org.id}/members`) : Promise.resolve(null),
        ])

        if (cancelled) return

        if (templatesRes.ok) {
          const data = await templatesRes.json()
          setTemplates(data)
        }
        if (membersRes && membersRes.ok) {
          const data = await membersRes.json()
          setMembers(data)
        }
      } catch {
        // Silently handle — dashboard is non-critical
      } finally {
        if (!cancelled) setLoadingStats(false)
      }
    }

    async function fetchActivity() {
      try {
        const res = await authFetch('/api/activity?limit=10')
        if (cancelled) return
        if (res.ok) {
          const data = await res.json()
          setActivity(data)
        }
      } catch {
        // Silently handle
      } finally {
        if (!cancelled) setLoadingActivity(false)
      }
    }

    void fetchStats()
    void fetchActivity()

    return () => { cancelled = true }
  }, [org])

  const currentPlan = (() => {
    if (!org) return 'Free'
    const entry = orgs.find((e) => e.org.id === org.id)
    const plan = entry?.org.plan ?? org.plan ?? 'FREE'
    return plan.charAt(0).toUpperCase() + plan.slice(1).toLowerCase()
  })()

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const recentTemplates = [...templates]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4)

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {/* Welcome header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Welcome back{user?.name ? `, ${user.name}` : ''}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{today}</p>
      </div>

      {/* Quick stats */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Total Templates"
          value={String(templates.length)}
          loading={loadingStats}
        />
        <StatCard
          label="Team Members"
          value={String(members.length)}
          loading={loadingStats}
        />
        <StatCard
          label="Current Plan"
          value={currentPlan}
          loading={loadingStats}
        />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Recent activity */}
        <div className="lg:col-span-2">
          <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Recent Activity</h2>
          {loadingActivity ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-8 w-8 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
                  <div className="flex-1 space-y-1">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                    <div className="h-3 w-1/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                  </div>
                </div>
              ))}
            </div>
          ) : activity.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 py-12 text-center dark:border-zinc-700">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-2 text-zinc-300 dark:text-zinc-600">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No recent activity</p>
            </div>
          ) : (
            <div className="space-y-1">
              {activity.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
                    {actionIcon(item.action)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-900 dark:text-zinc-100">
                      <span className="font-medium">{item.userName ?? 'System'}</span>
                      {' '}
                      <span className="text-zinc-500 dark:text-zinc-400">{item.action.toLowerCase()}</span>
                      {' '}
                      {item.entityName && (
                        <span className="font-medium">{item.entityName}</span>
                      )}
                      {item.entityType && (
                        <span className="text-zinc-400 dark:text-zinc-500"> ({item.entityType.toLowerCase()})</span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">{formatRelative(item.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent templates */}
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Recent Templates</h2>
            <Link
              to="/"
              className="text-xs font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
            >
              View all
            </Link>
          </div>
          {loadingStats ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
              ))}
            </div>
          ) : recentTemplates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 py-8 text-center dark:border-zinc-700">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No templates yet</p>
              <Link
                to="/"
                className="mt-2 inline-block text-xs font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400"
              >
                Create your first template
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {recentTemplates.map((t) => (
                <Link
                  key={t.id}
                  to={`/editor/${t.id}`}
                  className="block rounded-lg border border-zinc-200 bg-white p-3 transition-shadow hover:shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t.name}</p>
                  <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                    {formatDate(t.createdAt)}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
