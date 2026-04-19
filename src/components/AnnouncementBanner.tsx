import { useEffect, useState } from 'react'
import { API_BASE, authFetch } from '../lib/api'

/**
 * Fetches active staff-authored announcements and renders them as a
 * dismissible strip above the page content. Severity maps to colour —
 * `info` = sky, `warning` = amber, `critical` = red. Dismissed IDs are
 * stashed in localStorage so the same announcement doesn't keep popping
 * back up after the user has acknowledged it.
 */
interface ActiveAnnouncement {
  id: string
  title: string
  body: string
  severity: string
  startsAt: string | null
  endsAt: string | null
}

const DISMISSED_KEY = 'agreemint-announcement-dismissed'

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === 'string'))
  } catch {
    /* corrupt entry — start fresh */
  }
  return new Set()
}

function persistDismissed(ids: Set<string>): void {
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]))
}

export function AnnouncementBanner() {
  const [items, setItems] = useState<ActiveAnnouncement[] | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed())

  useEffect(() => {
    let cancelled = false
    // Fetch once on mount; re-fetch every 5 minutes so a newly-published
    // announcement shows up without a page reload. Cheap — one small GET.
    const load = async () => {
      try {
        const res = await authFetch(`${API_BASE}/api/announcements/active`)
        if (!res.ok) return
        const data = (await res.json()) as ActiveAnnouncement[]
        if (!cancelled) setItems(data)
      } catch {
        /* Banner is cosmetic; eat network errors quietly. */
      }
    }
    load()
    const handle = window.setInterval(load, 5 * 60 * 1000)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [])

  if (!items) return null
  const visible = items.filter((a) => !dismissed.has(a.id))
  if (visible.length === 0) return null

  const dismiss = (id: string) => {
    const next = new Set(dismissed)
    next.add(id)
    setDismissed(next)
    persistDismissed(next)
  }

  return (
    <div className="flex flex-col">
      {visible.map((a) => {
        const tone = toneClasses(a.severity)
        return (
          <div
            key={a.id}
            role="status"
            className={`flex items-start gap-3 border-b px-4 py-2 text-sm ${tone.border} ${tone.bg} ${tone.text}`}
          >
            <span
              className={`mt-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone.badge}`}
            >
              {a.severity}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{a.title}</p>
              {a.body && (
                <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-snug opacity-90">
                  {a.body}
                </p>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss announcement"
              onClick={() => dismiss(a.id)}
              className={`shrink-0 rounded p-1 opacity-70 hover:opacity-100 ${tone.dismissHover}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )
      })}
    </div>
  )
}

function toneClasses(severity: string): {
  bg: string
  border: string
  text: string
  badge: string
  dismissHover: string
} {
  switch (severity) {
    case 'critical':
      return {
        bg: 'bg-red-50 dark:bg-red-950/40',
        border: 'border-red-200 dark:border-red-900/60',
        text: 'text-red-900 dark:text-red-100',
        badge: 'bg-red-600 text-white',
        dismissHover: 'hover:bg-red-100 dark:hover:bg-red-900/60',
      }
    case 'warning':
      return {
        bg: 'bg-amber-50 dark:bg-amber-950/40',
        border: 'border-amber-200 dark:border-amber-900/60',
        text: 'text-amber-900 dark:text-amber-100',
        badge: 'bg-amber-600 text-white',
        dismissHover: 'hover:bg-amber-100 dark:hover:bg-amber-900/60',
      }
    default:
      return {
        bg: 'bg-sky-50 dark:bg-sky-950/40',
        border: 'border-sky-200 dark:border-sky-900/60',
        text: 'text-sky-900 dark:text-sky-100',
        badge: 'bg-sky-600 text-white',
        dismissHover: 'hover:bg-sky-100 dark:hover:bg-sky-900/60',
      }
  }
}
