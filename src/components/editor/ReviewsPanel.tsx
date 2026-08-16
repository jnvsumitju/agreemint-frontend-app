import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  decideReview,
  dismissReview,
  fetchTemplateReviews,
  reopenReview,
  type ReviewStatus,
  type TemplateReviewDto,
} from '../../lib/api'
import { useAuthStore } from '../../stores/authStore'
import { useEditorStore } from '../../stores/editorStore'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/ConfirmDialog'

/**
 * Sidebar panel that lists every review request on the current template.
 *
 * - Requester view: Reopen / Dismiss a decided review; see reviewer's summary.
 * - Reviewer view: Approve / Request changes with optional note when the review
 *   is still PENDING.
 * - Everyone: read-only list, grouped by version number.
 */
export function ReviewsPanel() {
  const toast = useToast()
  const templateId = useEditorStore((s) => s.templateId)
  const currentUserId = useAuthStore((s) => s.user?.id ?? null)
  const [reviews, setReviews] = useState<TemplateReviewDto[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!templateId) return
    setLoading(true)
    try {
      setReviews(await fetchTemplateReviews(templateId))
    } catch (err) {
      console.error('[ReviewsPanel] load failed', err)
    } finally {
      setLoading(false)
    }
  }, [templateId])

  useEffect(() => {
    void load()
  }, [load])

  const grouped = useMemo(() => {
    const map = new Map<number, TemplateReviewDto[]>()
    for (const r of reviews) {
      const arr = map.get(r.versionNumber) ?? []
      arr.push(r)
      map.set(r.versionNumber, arr)
    }
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0])
  }, [reviews])

  if (!templateId) return null

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Reviews</h3>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          title="Refresh"
        >
          ↻
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="py-4 text-center text-sm text-zinc-400">Loading…</div>
        ) : reviews.length === 0 ? (
          <div className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No reviews yet. Commit a version and request one.
          </div>
        ) : (
          <div className="space-y-4">
            {grouped.map(([versionNumber, rows]) => (
              <div key={versionNumber}>
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Version {versionNumber}
                </div>
                <div className="space-y-2">
                  {rows.map((r) => (
                    <ReviewRow
                      key={r.id}
                      review={r}
                      isReviewer={r.reviewer.id === currentUserId}
                      isRequester={r.requester.id === currentUserId}
                      onChanged={() => void load()}
                      templateId={templateId}
                      toastSuccess={(m) => toast.success(m)}
                      toastError={(m) => toast.error(m)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Single row ────────────────────────────────────────────────────────────────

function statusLabel(s: ReviewStatus) {
  switch (s) {
    case 'PENDING': return { text: 'Pending', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200' }
    case 'APPROVED': return { text: 'Approved', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200' }
    case 'CHANGES_REQUESTED': return { text: 'Changes requested', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200' }
    case 'DISMISSED': return { text: 'Dismissed', cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' }
  }
}

function initials(name: string | null | undefined): string {
  const safe = (name ?? '').trim()
  if (!safe) return '?'
  const parts = safe.split(/\s+/).filter(Boolean).slice(0, 2)
  if (parts.length === 0) return safe.charAt(0).toUpperCase()
  return parts.map((w) => w[0]!.toUpperCase()).join('')
}

function ReviewRow({
  review: r,
  isReviewer,
  isRequester,
  onChanged,
  templateId,
  toastSuccess,
  toastError,
}: {
  review: TemplateReviewDto
  isReviewer: boolean
  isRequester: boolean
  onChanged: () => void
  templateId: string
  toastSuccess: (m: string) => void
  toastError: (m: string) => void
}) {
  const confirm = useConfirm()
  const lbl = statusLabel(r.status)
  const [decidingAs, setDecidingAs] = useState<null | 'APPROVED' | 'CHANGES_REQUESTED'>(null)
  const [summary, setSummary] = useState('')
  const [working, setWorking] = useState(false)

  async function submitDecision(status: 'APPROVED' | 'CHANGES_REQUESTED') {
    setWorking(true)
    try {
      await decideReview(templateId, r.id, status, summary.trim() || undefined)
      toastSuccess(status === 'APPROVED' ? 'Review approved' : 'Changes requested')
      setDecidingAs(null)
      setSummary('')
      onChanged()
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to submit decision')
    } finally {
      setWorking(false)
    }
  }

  async function submitReopen() {
    setWorking(true)
    try {
      await reopenReview(templateId, r.id)
      toastSuccess('Review re-opened')
      onChanged()
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to reopen')
    } finally {
      setWorking(false)
    }
  }

  async function submitDismiss() {
    if (!(await confirm({
      title: 'Dismiss review?',
      description: 'It will no longer block the next commit.',
      confirmLabel: 'Dismiss review',
      variant: 'danger',
    }))) return
    setWorking(true)
    try {
      await dismissReview(templateId, r.id)
      toastSuccess('Review dismissed')
      onChanged()
    } catch (err) {
      toastError(err instanceof Error ? err.message : 'Failed to dismiss')
    } finally {
      setWorking(false)
    }
  }

  const canDecide = isReviewer && r.status === 'PENDING'
  const canManage = isRequester && r.status !== 'DISMISSED'

  return (
    <div className="rounded-md border border-zinc-200 bg-white p-2.5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-start gap-2">
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-200"
          title={r.reviewer.email}
        >
          {initials(r.reviewer.name || r.reviewer.email)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {r.reviewer.name || r.reviewer.email}
            </span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${lbl.cls}`}>
              {lbl.text}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            requested by {r.requester.name || r.requester.email}
            {' · '}
            {new Date(r.createdAt).toLocaleString()}
          </div>
        </div>
      </div>

      {r.message && (
        <div className="mt-2 rounded border-l-2 border-violet-400 bg-violet-50/60 px-2 py-1 text-[12px] leading-snug text-zinc-700 dark:border-violet-500 dark:bg-violet-900/20 dark:text-zinc-200">
          <span className="font-medium">Note:</span> {r.message}
        </div>
      )}

      {r.summary && (
        <div className="mt-2 rounded border-l-2 border-zinc-300 bg-zinc-50 px-2 py-1 text-[12px] leading-snug text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-200">
          <span className="font-medium">Reviewer:</span> {r.summary}
        </div>
      )}

      {canDecide && decidingAs === null && (
        <div className="mt-2 flex gap-2">
          <Button size="xs" variant="primary" onClick={() => setDecidingAs('APPROVED')}>
            Approve
          </Button>
          <Button size="xs" variant="secondary" onClick={() => setDecidingAs('CHANGES_REQUESTED')}>
            Request changes
          </Button>
        </div>
      )}

      {canDecide && decidingAs !== null && (
        <div className="mt-2 space-y-2">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            placeholder={decidingAs === 'APPROVED' ? 'Optional note' : 'What needs to change?'}
            className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-[12px] outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <div className="flex gap-2">
            <Button size="xs" variant="primary" loading={working} onClick={() => void submitDecision(decidingAs)}>
              {decidingAs === 'APPROVED' ? 'Submit approval' : 'Submit changes'}
            </Button>
            <Button size="xs" variant="secondary" onClick={() => { setDecidingAs(null); setSummary('') }} disabled={working}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {canManage && r.status !== 'PENDING' && (
        <div className="mt-2 flex gap-2">
          {(r.status === 'CHANGES_REQUESTED' || r.status === 'APPROVED') && (
            <Button size="xs" variant="secondary" loading={working} onClick={() => void submitReopen()}>
              Ask to re-review
            </Button>
          )}
          {r.status === 'CHANGES_REQUESTED' && (
            <Button size="xs" variant="secondary" loading={working} onClick={() => void submitDismiss()}>
              Dismiss
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
