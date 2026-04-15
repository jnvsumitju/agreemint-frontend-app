import type { TimelineEventDto } from '../../lib/api'

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const eventColors: Record<string, string> = {
  STATUS_CHANGE: 'bg-blue-500',
  SUBMITTED_FOR_REVIEW: 'bg-amber-500',
  STEP_APPROVED: 'bg-green-500',
  WORKFLOW_APPROVED: 'bg-green-600',
  WORKFLOW_REJECTED: 'bg-red-500',
  AUTO_EXPIRED: 'bg-amber-500',
}

function eventLabel(event: TimelineEventDto): string {
  const from = event.fromStatus?.replace(/_/g, ' ') ?? ''
  const to = event.toStatus.replace(/_/g, ' ')

  switch (event.eventType) {
    case 'SUBMITTED_FOR_REVIEW':
      return 'Submitted for review'
    case 'STEP_APPROVED':
      return 'Approval step completed'
    case 'WORKFLOW_APPROVED':
      return `Approved`
    case 'WORKFLOW_REJECTED':
      return `Rejected`
    case 'AUTO_EXPIRED':
      return 'Automatically expired'
    default:
      return from ? `${from} \u2192 ${to}` : to
  }
}

export function DocumentTimeline({ events }: { events: TimelineEventDto[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-zinc-400 dark:text-zinc-500">No activity yet</p>
  }

  return (
    <div className="relative space-y-0">
      {events.map((event, i) => (
        <div key={event.id} className="relative flex gap-3 pb-6 last:pb-0">
          {/* Connector line */}
          {i < events.length - 1 && (
            <div className="absolute left-[7px] top-4 h-full w-px bg-zinc-200 dark:bg-zinc-700" />
          )}

          {/* Dot */}
          <div
            className={`relative mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2 border-white dark:border-zinc-900 ${
              eventColors[event.eventType] ?? 'bg-zinc-400'
            }`}
          />

          {/* Content */}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
              {eventLabel(event)}
            </p>
            {event.actorName && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                by {event.actorName}
              </p>
            )}
            {event.comment && (
              <p className="mt-1 rounded-md bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {event.comment}
              </p>
            )}
            <p className="mt-0.5 text-[11px] text-zinc-400 dark:text-zinc-500">
              {formatRelative(event.createdAt)}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
