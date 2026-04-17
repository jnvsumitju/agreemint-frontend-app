import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchReviewsAssignedToMe, type TemplateReviewDto } from '../lib/api'
import { Card, CardHeader, CardContent } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'

/**
 * "Reviews assigned to me" — top-level inbox page for reviewers.
 * Polls on focus; clicking a row navigates to the template editor with the
 * Reviews tab selected (via ?tab=reviews query param — handled by TemplateEditor).
 */
export function ReviewsInbox() {
  const [rows, setRows] = useState<TemplateReviewDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const data = await fetchReviewsAssignedToMe(100)
        if (!cancelled) setRows(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load reviews')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Reviews</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Templates waiting on your review. Open one to approve or request changes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <span className="text-sm font-semibold">Pending</span>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-sm text-zinc-400">Loading…</div>
          ) : error ? (
            <div className="py-8 text-center text-sm text-red-500">{error}</div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="Nothing to review"
              description="You're all caught up — no one has asked for your review right now."
            />
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link
                    to={`/editor/${r.templateId}?tab=reviews`}
                    className="flex items-center gap-3 px-1 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-200">
                      v{r.versionNumber}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Review requested by {r.requester.name || r.requester.email}
                      </div>
                      <div className="truncate text-[12px] text-zinc-500 dark:text-zinc-400">
                        {r.message ? r.message : 'No note'}
                        {' · '}
                        {new Date(r.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                      Pending
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
