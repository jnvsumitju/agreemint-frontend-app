import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authFetch, type TemplateDto } from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import { usePermissions } from '../hooks/usePermissions'
import { Card, CardHeader, CardContent } from '../components/ui/Card'
import { Skeleton, SkeletonRow } from '../components/ui/Skeleton'
import { EmptyState } from '../components/ui/EmptyState'
import { Badge } from '../components/ui/Badge'

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
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
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

function activityDateGroup(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return 'This week'
  return 'Earlier'
}

const actionIconMap: Record<string, { color: string; path: string }> = {
  created: { color: 'text-green-500', path: 'M12 4v16m8-8H4' },
  updated: { color: 'text-blue-500', path: 'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10' },
  deleted: { color: 'text-red-500', path: 'M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0' },
  published: { color: 'text-violet-500', path: 'M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5' },
}

function ActionIcon({ action }: { action: string }) {
  const cfg = actionIconMap[action.toLowerCase()] ?? { color: 'text-zinc-400', path: 'M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z' }
  return (
    <svg className={`h-4 w-4 ${cfg.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={cfg.path} />
    </svg>
  )
}

/* ── Onboarding Checklist ── */

function OnboardingChecklist({ templates, members }: { templates: TemplateDto[]; members: OrgMember[] }) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('agreemint-onboarding-dismissed') === 'true')
  const { org } = useAuthStore()

  if (dismissed) return null

  const steps = [
    { label: 'Create your first template', done: templates.length > 0, href: '/' },
    { label: 'Set up your workspace logo', done: !!org?.logoUrl, href: '/settings?tab=org' },
    { label: 'Invite a team member', done: members.length > 1, href: '/settings?tab=members' },
    { label: 'Explore the marketplace', done: false, href: '/marketplace' },
  ]

  const completedCount = steps.filter((s) => s.done).length
  const allDone = completedCount === steps.length

  if (allDone) return null

  return (
    <Card className="mb-6 overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/30">
            <svg className="h-4 w-4 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Getting started</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{completedCount} of {steps.length} completed</p>
          </div>
        </div>
        <button
          onClick={() => { setDismissed(true); localStorage.setItem('agreemint-onboarding-dismissed', 'true') }}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          aria-label="Dismiss"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full rounded-r-full bg-violet-500 transition-all duration-500"
          style={{ width: `${(completedCount / steps.length) * 100}%` }}
        />
      </div>

      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {steps.map((step) => (
          <Link
            key={step.label}
            to={step.href}
            className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
          >
            {step.done ? (
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <svg className="h-3 w-3 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
            ) : (
              <div className="h-5 w-5 rounded-full border-2 border-zinc-300 dark:border-zinc-600" />
            )}
            <span className={`text-sm ${step.done ? 'text-zinc-400 line-through dark:text-zinc-500' : 'text-zinc-700 dark:text-zinc-300'}`}>
              {step.label}
            </span>
          </Link>
        ))}
      </div>
    </Card>
  )
}

/* ── Stat Card ── */

function StatCard({ label, value, icon, loading }: { label: string; value: string; icon: React.ReactNode; loading: boolean }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400">
          {icon}
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{label}</p>
          {loading ? (
            <Skeleton className="mt-1 h-7 w-14" />
          ) : (
            <p className="mt-0.5 text-2xl font-bold text-zinc-900 dark:text-zinc-100">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/* ── Quick Actions ── */

function QuickActions() {
  const navigate = useNavigate()
  const { canCreateTemplates, canManageOrg } = usePermissions()

  const actions: { label: string; icon: React.ReactNode; onClick: () => void; color: string }[] = []

  if (canCreateTemplates) {
    actions.push({
      label: 'Create Template',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      ),
      onClick: () => navigate('/'),
      color: 'bg-violet-500 text-white',
    })
  }

  if (canManageOrg) {
    actions.push({
      label: 'Invite Member',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
        </svg>
      ),
      onClick: () => navigate('/settings?tab=members'),
      color: 'bg-blue-500 text-white',
    })
  }

  actions.push({
    label: canCreateTemplates ? 'Marketplace' : 'Browse Templates',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 003.75.614m-16.5 0a3.004 3.004 0 01-.621-4.72L4.318 3.44A1.5 1.5 0 015.378 3h13.243a1.5 1.5 0 011.06.44l1.19 1.189a3 3 0 01-.621 4.72m-13.5 8.65h3.75a.75.75 0 00.75-.75V13.5a.75.75 0 00-.75-.75H6.75a.75.75 0 00-.75.75v3.15c0 .415.336.75.75.75z" />
      </svg>
    ),
    onClick: () => canCreateTemplates ? navigate('/marketplace') : navigate('/'),
    color: 'bg-emerald-500 text-white',
  })

  return (
    <div className="mb-6 flex gap-3">
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={a.onClick}
          className="group flex flex-1 items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition-all hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600"
        >
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${a.color} transition-transform group-hover:scale-105`}>
            {a.icon}
          </div>
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{a.label}</span>
        </button>
      ))}
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
        if (templatesRes.ok) setTemplates(await templatesRes.json())
        if (membersRes && membersRes.ok) setMembers(await membersRes.json())
      } catch (err) {
        console.error('[Dashboard] Failed to fetch stats:', err)
      } finally {
        if (!cancelled) setLoadingStats(false)
      }
    }

    async function fetchActivity() {
      try {
        const res = await authFetch('/api/activity?limit=15')
        if (cancelled) return
        if (res.ok) setActivity(await res.json())
      } catch (err) {
        console.error('[Dashboard] Failed to fetch activity:', err)
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

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const recentTemplates = [...templates]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)

  // Group activity by date
  const groupedActivity: { label: string; items: ActivityItem[] }[] = []
  for (const item of activity) {
    const group = activityDateGroup(item.createdAt)
    const existing = groupedActivity.find((g) => g.label === group)
    if (existing) existing.items.push(item)
    else groupedActivity.push({ label: group, items: [item] })
  }

  return (
    <div className="page-enter mx-auto max-w-5xl px-4 py-8">
      {/* Welcome header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
        </h1>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{today}</p>
      </div>

      {/* Quick Actions */}
      <QuickActions />

      {/* Onboarding Checklist */}
      <OnboardingChecklist templates={templates} members={members} />

      {/* Stats */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Templates"
          value={String(templates.length)}
          loading={loadingStats}
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>}
        />
        <StatCard
          label="Team Members"
          value={String(members.length)}
          loading={loadingStats}
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>}
        />
        <StatCard
          label="Plan"
          value={currentPlan}
          loading={loadingStats}
          icon={<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" /></svg>}
        />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Activity (grouped) */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Recent Activity" />
            {loadingActivity ? (
              <CardContent className="space-y-4">
                {[1, 2, 3, 4].map((i) => <SkeletonRow key={i} />)}
              </CardContent>
            ) : activity.length === 0 ? (
              <CardContent>
                <EmptyState
                  title="No activity yet"
                  description="Activity from your team will appear here"
                  icon={<svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                />
              </CardContent>
            ) : (
              <div>
                {groupedActivity.map((group) => (
                  <div key={group.label}>
                    <div className="border-b border-zinc-100 bg-zinc-50/50 px-6 py-2 dark:border-zinc-800 dark:bg-zinc-800/30">
                      <span className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                        {group.label}
                      </span>
                    </div>
                    <div className="divide-y divide-zinc-50 dark:divide-zinc-800/50">
                      {group.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-start gap-3 px-6 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                        >
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
                            <ActionIcon action={item.action} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-zinc-900 dark:text-zinc-100">
                              <span className="font-medium">{item.userName ?? 'System'}</span>
                              {' '}
                              <span className="text-zinc-500 dark:text-zinc-400">{item.action.toLowerCase()}</span>
                              {' '}
                              {item.entityName && <span className="font-medium">{item.entityName}</span>}
                              {item.entityType && (
                                <Badge variant="default" size="sm" className="ml-1.5 align-middle">
                                  {item.entityType.toLowerCase()}
                                </Badge>
                              )}
                            </p>
                            <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">{formatRelative(item.createdAt)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Recent Templates */}
        <div>
          <Card>
            <CardHeader
              title="Recent Templates"
              action={
                <Link to="/" className="text-xs font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400">
                  View all
                </Link>
              }
            />
            {loadingStats ? (
              <CardContent className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
              </CardContent>
            ) : recentTemplates.length === 0 ? (
              <CardContent>
                <EmptyState
                  title="No templates yet"
                  description="Create your first template to get started"
                  icon={<svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>}
                  action={{ label: 'Create template', onClick: () => { /* handled by link */ } }}
                />
              </CardContent>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {recentTemplates.map((t) => (
                  <Link
                    key={t.id}
                    to={`/editor/${t.id}`}
                    className="flex items-center gap-3 px-6 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-900/20">
                      <svg className="h-4 w-4 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{t.name}</p>
                      <p className="text-xs text-zinc-400 dark:text-zinc-500">{formatDate(t.createdAt)}</p>
                    </div>
                    <svg className="h-4 w-4 shrink-0 text-zinc-300 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
